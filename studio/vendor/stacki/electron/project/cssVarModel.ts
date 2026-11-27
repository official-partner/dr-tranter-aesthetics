
import { variableFiles as fs } from './variableWorkspace';
import path from 'path';
import { runSliced, runSync, type SlicedWork } from '../lib/slicedWork';
import { assert } from '../../shared/core/assert';
import { described, type MessageRef } from '../../shared/properties/i18n/messageRef';
import { toPosix, stylesheetsSliced, type VarEntry, type Rule, readDeclarations } from './cssVarRead';
import { labelForRule, commonStem, namesOf, groupRules, findFamilies, prefixSections } from './cssVarGroups';
import { shortLabel } from '../../shared/properties/variableGroups';
import { resolveValue, colorOf, isUncomputableColor, kindOf, type ValueLookup } from './cssVarValues';
import { astroSourcesSliced, isAstroFile, readAstroVariables, relativeTo, type VariableScope } from './cssVarRegions';

export interface Column {
  readonly id: string;
  readonly label: string;
  readonly selector: string;
  readonly context: readonly string[];
  readonly line: number;
}

export interface Cell {
  readonly name: string;
  readonly value: string;
  readonly file: string;
  readonly selector: string;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly line: number;
  readonly column: string;
}

export interface Row {
  readonly label: string;
  readonly name?: string;
  cells: (Cell | undefined)[];
}

export interface Block {
  readonly kind: 'rows' | 'matrix';
  readonly title: string | undefined;
  readonly titleStart?: number;
  readonly titleEnd?: number;
  readonly description?: string;
  readonly rows: Row[];
  readonly columns?: Column[];
}

export interface Group {
  readonly kind: 'modes' | 'single';
  readonly label: string;
  readonly columns: Column[];
  readonly blocks: Block[];
  readonly scope?: VariableScope;
}

export interface FileModel {
  readonly rel: string;
  readonly name: string;
  readonly groups: Group[];
  readonly error?: string;
  readonly errorRef?: MessageRef | undefined;
  readonly count?: number;
  declarations?: Rule[];
}

export interface TaggedVar extends VarEntry {
  readonly selector: string;
}

export function buildGroup(members: readonly Rule[], file: string): Group {
  assert(members.length > 0, 'buildGroup: a group has at least one rule');
  const columns = members.map((rule, index) => ({
    id: `${index}`,
    label: labelForRule(rule),
    selector: rule.selector,
    context: rule.context,
    line: rule.line,
  }));
  const byName = members.map((rule): Map<string, TaggedVar> => {
    const map = new Map<string, TaggedVar>();
    for (const entry of rule.entries) {
      if (entry.kind === 'var') {
        map.set(entry.name, { ...entry, selector: rule.selector });
      }
    }
    return map;
  });

  if (members.length > 1) {
    return modesGroup(columns, byName, file);
  }
  const rule = members[0];
  if (!rule) {
    return { kind: 'single', label: '', columns, blocks: [] };
  }
  const blocks = commentSections(rule).flatMap((section) => sectionBlocks(section, rule, byName[0], file));
  return { kind: 'single', label: labelForRule(rule), columns, blocks };
}

export function modesGroup(columns: Column[], byName: readonly Map<string, TaggedVar>[], file: string): Group {
  const cellsFor = (name: string): (Cell | undefined)[] => byName.map((map, index) => cellFor(map, name, file, columns[index]?.id ?? ''));
  const names: string[] = [];
  for (const map of byName) {
    for (const name of map.keys()) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  const blocks: Block[] = [];
  const { loose, sections } = prefixSections(names);
  if (loose.length) {
    blocks.push({
      kind: 'rows',
      title: undefined,
      rows: loose.map((name) => ({ label: shortLabel(name), name, cells: cellsFor(name) })),
    });
  }
  for (const [prefix, group] of sections) {
    blocks.push({
      kind: 'rows',
      title: prefix,
      rows: group.map((name) => ({
        label: shortLabel(name, prefix),
        name,
        cells: cellsFor(name),
      })),
    });
  }
  const firstLabel = columns[0]?.label ?? '';
  return {
    kind: 'modes',
    label: commonStem(columns.map((column) => column.label)) || firstLabel,
    columns,
    blocks,
  };
}

export interface CommentSection {
  title: string | undefined;
  titleStart?: number;
  titleEnd?: number;
  description?: string;
  names: string[];
}

export function commentSections(rule: Rule): CommentSection[] {
  const sections: CommentSection[] = [];
  let current: CommentSection = { title: undefined, names: [] };
  for (const entry of rule.entries) {
    if (entry.kind === 'comment') {
      if (current.names.length || current.title !== undefined) {
        sections.push(current);
      }
      current = {
        title: entry.text,
        titleStart: entry.textStart,
        titleEnd: entry.textEnd,
        ...(entry.description === undefined ? {} : { description: entry.description }),
        names: [],
      };
      continue;
    }
    current.names.push(entry.name);
  }
  if (current.names.length || current.title !== undefined) {
    sections.push(current);
  }
  return sections;
}

export function sectionBlocks(section: CommentSection, rule: Rule, map: Map<string, TaggedVar> | undefined, file: string): Block[] {
  const blocks: Block[] = [];
  const { families, used } = findFamilies(section.names);
  const claimed = new Set<string>();
  for (const family of families) {
    const rows: Row[] = [];
    if (family.self) {
      rows.push({
        label: 'value',
        cells: family.prefixes.map((prefix) => cellFor(map, `--${prefix}`, file, '0')),
      });
      for (const prefix of family.prefixes) {
        claimed.add(`--${prefix}`);
      }
    }
    for (const suffix of family.rows) {
      rows.push({
        label: suffix,
        cells: family.prefixes.map((prefix) => cellFor(map, `--${prefix}-${suffix}`, file, '0')),
      });
      for (const prefix of family.prefixes) {
        claimed.add(`--${prefix}-${suffix}`);
      }
    }
    blocks.push({
      kind: 'matrix',
      title: section.title,
      columns: family.prefixes.map((prefix): Column => ({
        id: prefix,
        label: prefix,
        selector: rule.selector,
        context: rule.context,
        line: rule.line,
      })),
      rows: rows.filter((row) => row.cells.some(Boolean)),
      ...(section.titleStart !== undefined ? { titleStart: section.titleStart, titleEnd: section.titleEnd } : {}),
      ...descriptionOf(section),
    });
  }
  const leftovers = section.names.filter((name) => !claimed.has(name) && !used.has(name));
  if (leftovers.length || (!families.length && section.title !== undefined)) {
    blocks.push({
      kind: 'rows',
      title: families.length ? undefined : section.title,
      rows: leftovers.map((name) => ({
        label: shortLabel(name),
        name,
        cells: [cellFor(map, name, file, '0')],
      })),
      ...(families.length ? {} : { titleStart: section.titleStart, titleEnd: section.titleEnd }),
      ...(families.length ? {} : descriptionOf(section)),
    });
  }
  return blocks;
}

function descriptionOf(section: CommentSection): { readonly description?: string } {
  return section.description === undefined ? {} : { description: section.description };
}

export function cellFor(map: Map<string, TaggedVar> | undefined, name: string, file: string, column: string): Cell | undefined {
  const entry = map?.get(name);
  if (!entry) {
    return undefined;
  }
  return {
    name,
    value: entry.value,
    file,
    selector: entry.selector,
    valueStart: entry.valueStart,
    valueEnd: entry.valueEnd,
    line: entry.line,
    column,
  };
}

export interface DescribedCell extends Cell {
  readonly ref?: string;
  readonly resolved?: string;
  readonly color?: string;
  readonly unknownColor: boolean;
  readonly kind: string;
}

export function describeCell(cell: Cell | undefined, map: ValueLookup): DescribedCell | undefined {
  if (!cell) {
    return undefined;
  }
  const single = String(cell.value)
    .trim()
    .match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
  const resolved = resolveValue(cell.value, map);
  const ref = single?.[1];
  const color = colorOf(resolved);
  return {
    ...cell,
    ...(ref === undefined ? {} : { ref }),
    ...(resolved === cell.value ? {} : { resolved }),
    ...(color === undefined ? {} : { color }),
    unknownColor: isUncomputableColor(resolved),
    kind: kindOf(cell.value, resolved),
  };
}

export { shortLabel };

export interface VariablesModel {
  files: FileModel[];
  values: Record<string, string>;
}

export function* variablesSliced(projectPath: string): SlicedWork<VariablesModel> {
  const files: FileModel[] = [];
  for (const abs of yield* stylesheetsSliced(projectPath)) {
    yield;
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = toPosix(path.relative(projectPath, abs));
    let rules: Rule[];
    try {
      rules = readDeclarations(text);
    } catch (error: unknown) {
      const parseFailure = described('variables.error.parse', { detail: error instanceof Error ? error.message : String(error) });
      files.push({ rel, name: path.basename(abs), error: parseFailure.message, errorRef: parseFailure.messageRef, groups: [] });
      continue;
    }
    if (!rules.length) {
      continue;
    }
    const groups = groupRules(rules).map((members) => buildGroup(members, rel));
    files.push({
      rel,
      name: path.basename(abs),
      groups,
      declarations: rules,
      count: rules.reduce((sum, rule) => sum + namesOf(rule).length, 0),
    });
  }
  files.push(...(yield* readAstroFiles(projectPath)));
  const map = new Map<string, string>();
  for (const file of files) {
    for (const rule of file.declarations || []) {
      for (const entry of rule.entries) {
        if (entry.kind === 'var') {
          if (!isAstroFile(file.rel) || !map.has(entry.name)) {
            map.set(entry.name, entry.value);
          }
        }
      }
    }
  }
  const values = Object.fromEntries(map);
  const scopes = variableScopes(files);
  for (const file of files) {
    delete file.declarations;
    for (const group of file.groups) {
      for (const block of group.blocks) {
        for (const row of block.rows) {
          row.cells = row.cells.map((cell) => describeCell(cell, cell === undefined ? map : scopes.mapFor(cell)));
        }
      }
    }
    yield;
  }
  return { files, values };
}

export function readVariables(projectPath: string): VariablesModel {
  return runSync(variablesSliced(projectPath));
}

export function readVariablesSliced(projectPath: string): Promise<VariablesModel> {
  return runSliced(variablesSliced(projectPath));
}

function* readAstroFiles(projectPath: string): SlicedWork<FileModel[]> {
  const files: FileModel[] = [];
  for (const abs of yield* astroSourcesSliced(projectPath)) {
    yield;
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = relativeTo(projectPath, abs);
    const name = rel.replace(/^src\//, '');
    const read = readAstroVariables(rel, text);
    if (read.kind === 'error') {
      const parseFailure = described('variables.error.parse', { detail: read.message });
      files.push({ rel, name, error: parseFailure.message, errorRef: read.messageRef ?? parseFailure.messageRef, groups: [] });
    } else if (read.kind === 'rules') {
      const rules = read.sections.flatMap((section) => section.rules);
      assert(rules.length > 0, 'readAstroFiles: a read with sections holds rules');
      const groups = read.sections.flatMap((section) => groupRules(section.rules).map((members) => ({ ...buildGroup(members, rel), scope: section.scope })));
      files.push({ rel, name, groups, declarations: rules, count: rules.reduce((sum, rule) => sum + namesOf(rule).length, 0) });
    }
  }
  return files;
}

function variableScopes(files: readonly FileModel[]) {
  const base = new Map<string, string>();
  const fallback = new Map<string, string>();
  const scopes = new Map<string, Map<string, string>>();
  const scopeOfEntry = new Map<string, string>();
  const fileBases = new Map<string, Map<string, string>>();
  for (const file of files) {
    const astro = isAstroFile(file.rel);
    const fileBase = new Map<string, string>();
    if (astro) {
      fileBases.set(file.rel, fileBase);
    }
    for (const rule of file.declarations || []) {
      const scope = `${astro ? file.rel : ''}\n${rule.context.join('\n')}\n${rule.selector}`;
      const declared = scopes.get(scope) ?? new Map<string, string>();
      scopes.set(scope, declared);
      for (const entry of rule.entries) {
        if (entry.kind !== 'var') {
          continue;
        }
        declared.set(entry.name, entry.value);
        scopeOfEntry.set(`${file.rel}:${entry.valueStart}`, scope);
        if (!fallback.has(entry.name)) {
          fallback.set(entry.name, entry.value);
        }
        if (rule.context.length === 0) {
          if (!base.has(entry.name)) {
            base.set(entry.name, entry.value);
          }
          if (!fileBase.has(entry.name)) {
            fileBase.set(entry.name, entry.value);
          }
        }
      }
    }
  }
  assert(base.size <= fallback.size, 'Base values are a subset of every declared name');
  const layered = new Map<string, ValueLookup>();
  const mapFor = (cell: Cell): ValueLookup => {
    const scope = scopeOfEntry.get(`${cell.file}:${cell.valueStart}`);
    assert(scope !== undefined, 'Every described cell was read from a rule');
    const known = layered.get(scope);
    if (known !== undefined) {
      return known;
    }
    const layers: readonly ValueLookup[] = [
      scopes.get(scope) ?? new Map<string, string>(),
      fileBases.get(cell.file) ?? new Map<string, string>(),
      base,
      fallback,
    ];
    const lookup: ValueLookup = {
      get(name: string): string | undefined {
        for (const layer of layers) {
          const found = layer.get(name);
          if (found !== undefined) {
            return found;
          }
        }
        return undefined;
      },
    };
    assert(lookup.get(cell.name) !== undefined, 'A cell resolves in a scope that declares it');
    layered.set(scope, lookup);
    return lookup;
  };
  return { mapFor };
}
