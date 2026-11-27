
import { readSource } from '../lib/mainLimits';
import { toRecord } from '../../shared/core/record';
import { dictionary, list, text } from '../../shared/core/boundary';
import * as path from 'path';
import * as fs from 'fs';
import { readComponentSources, packageSourcePath } from '../lib/componentSources';
import { componentSourceRoot } from '../../shared/properties/componentSources';


export function projectAliases(projectPath: string) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(projectPath, name);
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      const raw = readSource(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
      const input: unknown = JSON.parse(raw);
      const aliases = toRecord(toRecord(input)?.['compilerOptions'])?.['paths'];
      if (aliases) {
        return parseAliases(input);
      }
    } catch {
    }
  }
  return [];
}

export const SOURCE_EXTENSIONS = ['', '.ts', '.js', '.mjs', '.mts', '.tsx', '.jsx', '.json', '.astro'];

export function firstExisting(base: string) {
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  for (const ext of SOURCE_EXTENSIONS.slice(1)) {
    const candidate = path.join(base, 'index' + ext);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveImportPath(projectPath: string, fromFile: string, spec: string) {
  const specifier = String(spec || '');
  if (!specifier) {
    return undefined;
  }
  for (const source of readComponentSources(projectPath)) {
    if (specifier.startsWith(source.importPrefix)) {
      const relative = componentSourceRoot(source) + '/' + specifier.slice(source.importPrefix.length);
      packageSourcePath(projectPath, relative);
      return path.resolve(projectPath, relative);
    }
  }
  if (specifier.startsWith('.')) {
    return firstExisting(path.resolve(path.dirname(fromFile), specifier));
  }
  for (const [prefix, targets] of projectAliases(projectPath)) {
    if (!prefix || !specifier.startsWith(prefix)) {
      continue;
    }
    const rest = specifier.slice(prefix.length);
    for (const target of targets) {
      const found = firstExisting(path.resolve(projectPath, target, rest));
      if (found) {
        return found;
      }
    }
  }
  if (specifier.startsWith('/')) {
    return firstExisting(path.join(projectPath, specifier.slice(1)));
  }
  return undefined;
}

export function declarationLine(text: string, name: string) {
  if (!name) {
    return 0;
  }
  const re = new RegExp(
    `^[ \\t]*(?:export\\s+)?(?:const|let|var|function|class)\\s+` + `${String(name).replace(/[^\w$]/g, '')}\\b`,
    'm',
  );
  const match = re.exec(text);
  if (!match) {
    return 0;
  }
  return text.slice(0, match.index).split('\n').length;
}

export function parseAliases(input: unknown): readonly (readonly [string, readonly string[]])[] {
  const paths = toRecord(toRecord(toRecord(input)?.['compilerOptions'])?.['paths']);
  if (!paths) {
    return [];
  }
  return Object.entries(dictionary((value) => list(text)(typeof value === 'string' ? [value] : value))(paths)).map(
    ([key, values]) => [key.replace(/\*$/, ''), values.map((value) => value.replace(/\*$/, ''))] as const,
  );
}
