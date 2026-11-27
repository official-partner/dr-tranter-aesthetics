
import { LIMITS } from '../core/limits';
import { parseComponentOrigin, type ComponentOrigin } from './componentSources';
import { parseField, type PropField } from './propSchema';
import { parseLengthUnit, type LengthUnit } from './lengthUnit';
import { PACKAGE_MANAGERS, type PackageManager } from './packageManager';

export interface ScanPage {
  readonly path: string;
  readonly name: string;
  readonly route: string;
  readonly title?: string | undefined;
  readonly inheritedTitle?: string | undefined;
}

export interface RenderTag {
  readonly tag?: string;
  readonly prop?: string;
}

export const SCAN_WARNING_CODES = [
  'dependencies-missing',
  'folder-unreadable',
  'link-broken',
  'link-cycle',
  'config-unreadable',
  'config-computed',
  'config-folder-custom',
  'scan-step-failed',
] as const;
export type ScanWarningCode = (typeof SCAN_WARNING_CODES)[number];

export interface ScanWarning {
  readonly code: ScanWarningCode;
  readonly message: string;
  readonly file?: string | undefined;
  readonly detail?: string | undefined;
}

export interface ScanComponent {
  readonly origin?: ComponentOrigin;
  readonly path: string;
  readonly file?: string;
  readonly name: string;
  readonly folder: string;
  readonly isLayout?: boolean;
  readonly instances?: number;
  readonly uses?: readonly ScanComponentUse[];
  readonly schema?: readonly PropField[];
  readonly extendsTag?: string | undefined;
  readonly slots?: readonly string[];
  readonly slotText?: boolean;
  readonly renderTag?: RenderTag | undefined;
  readonly rootComponent?: string | undefined;
  readonly hasRest?: boolean;
  readonly setHtml?: boolean;
  readonly htmlProps?: readonly string[];
}

export interface ScanComponentUse {
  readonly file: string;
  readonly count: number;
}

export interface ScanResult {
  readonly pages: readonly ScanPage[];
  readonly pageFolders: readonly string[];
  readonly layouts: readonly ScanComponent[];
  readonly components: readonly ScanComponent[];
  readonly trailingSlash?: string;
  readonly lengthUnit?: LengthUnit;
  readonly pagesFolder?: string;
  readonly astroConfig?: string;
  readonly packageManager?: PackageManager;
  readonly warnings?: readonly ScanWarning[];
}

function fail(where: string, what: string): never {
  throw new Error(`ScanResult.${where}: ${what}`);
}

function parseSchemaArray(input: unknown, where: string): readonly PropField[] {
  if (!Array.isArray(input)) {
    fail(where, 'expected array of fields');
  }
  if (input.length > LIMITS.propSchemaFieldsMax) {
    fail(where, `exceeds ${LIMITS.propSchemaFieldsMax} fields`);
  }
  return input.map((field, index) => parseField(field, `${where}[${index}]`)) as readonly PropField[];
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    fail(where, 'expected string');
  }
  if (value.length > LIMITS.ipcFieldCharsMax) {
    fail(where, `exceeds ${LIMITS.ipcFieldCharsMax} chars`);
  }
  return value;
}

function asArray(input: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(input)) {
    fail(where, 'expected array');
  }
  if (input.length > max) {
    fail(where, `exceeds ${max} entries`);
  }
  return input;
}

function asRecord(input: unknown, where: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(where, 'expected object');
  }
  return input as Record<string, unknown>;
}

function parsePage(input: unknown, where: string): ScanPage {
  const record = asRecord(input, where);
  return {
    path: asString(record['path'], `${where}.path`),
    name: asString(record['name'], `${where}.name`),
    route: asString(record['route'], `${where}.route`),
    ...(record['title'] === undefined ? {} : { title: asString(record['title'], `${where}.title`) }),
    ...(record['inheritedTitle'] === undefined ? {} : { inheritedTitle: asString(record['inheritedTitle'], `${where}.inheritedTitle`) }),
  };
}

function parseComponentUses(input: unknown, where: string): readonly ScanComponentUse[] {
  const files = new Set<string>();
  return asArray(input, where, LIMITS.scanEntriesMax).map((entry, index) => {
    const record = asRecord(entry, `${where}[${index}]`);
    const file = asString(record['file'], `${where}[${index}].file`);
    if (file.length === 0 || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..')) {
      fail(`${where}[${index}]`, 'file: expected a project-relative, /-separated path');
    }
    if (files.has(file)) {
      fail(`${where}[${index}]`, 'file: listed twice');
    }
    files.add(file);
    const count = record['count'];
    if (typeof count !== 'number' || !Number.isSafeInteger(count)) {
      fail(`${where}[${index}]`, 'count: expected an integer');
    }
    if (count < 1) {
      fail(`${where}[${index}]`, 'count: a file that uses the component none is left out');
    }
    return { file, count };
  });
}

function parseComponent(input: unknown, where: string): ScanComponent {
  const record = asRecord(input, where);
  const out: Record<string, unknown> = {
    ...(record['origin'] === undefined ? {} : { origin: parseComponentOrigin(record['origin']) }),
    path: asString(record['path'], `${where}.path`),
    name: asString(record['name'], `${where}.name`),
    folder: asString(record['folder'], `${where}.folder`),
  };
  if (record['file'] !== undefined) {
    const file = asString(record['file'], `${where}.file`);
    if (file.length === 0 || file.startsWith('/') || file.split('/').includes('..')) {
      fail(where, 'file: expected a project-relative path');
    }
    out['file'] = file;
  }
  if (record['isLayout'] !== undefined) {
    if (record['isLayout'] !== true) {
      fail(where, 'isLayout: only true is ever written');
    }
    out['isLayout'] = true;
  }
  if (record['instances'] !== undefined) {
    if (!Number.isSafeInteger(record['instances']) || Number(record['instances']) < 0) {
      fail(where, 'instances: expected nonnegative integer');
    }
    out['instances'] = record['instances'];
  }
  if (record['uses'] !== undefined) {
    if (out['instances'] === undefined) {
      fail(where, 'uses: written only beside instances');
    }
    const uses = parseComponentUses(record['uses'], `${where}.uses`);
    if (uses.reduce((total, use) => total + use.count, 0) !== out['instances']) {
      fail(where, 'uses: counts do not sum to instances');
    }
    out['uses'] = uses;
  }
  if (record['schema'] !== undefined) {
    out['schema'] = parseSchemaArray(record['schema'], `${where}.schema`);
  }
  if (record['extendsTag'] !== undefined) {
    out['extendsTag'] = asString(record['extendsTag'], `${where}.extendsTag`);
  }
  if (record['renderTag'] !== undefined) {
    const renderTag = asRecord(record['renderTag'], `${where}.renderTag`);
    const tag = renderTag['tag'];
    if (tag !== undefined && typeof tag !== 'string') {
      fail(where, 'renderTag.tag: expected string');
    }
    const prop = renderTag['prop'];
    if (prop !== undefined && typeof prop !== 'string') {
      fail(where, 'renderTag.prop: expected string');
    }
    out['renderTag'] = { tag, prop };
  }
  if (record['rootComponent'] !== undefined) {
    const rootComponent = asString(record['rootComponent'], `${where}.rootComponent`);
    if (rootComponent.length === 0) {
      fail(where, 'rootComponent: expected non-empty string');
    }
    if (rootComponent.length > LIMITS.tagNameCharsMax) {
      fail(where, `rootComponent: exceeds ${LIMITS.tagNameCharsMax} chars`);
    }
    out['rootComponent'] = rootComponent;
  }
  if (record['slots'] !== undefined) {
    const slots = asArray(record['slots'], `${where}.slots`, LIMITS.propOptionsMax);
    if (!slots.every((slot) => typeof slot === 'string')) {
      fail(where, 'slots: expected strings');
    }
    out['slots'] = slots as readonly string[];
  }
  if (record['slotText'] !== undefined) {
    if (typeof record['slotText'] !== 'boolean') {
      fail(where, 'slotText: expected boolean');
    }
    out['slotText'] = record['slotText'];
  }
  if (record['htmlProps'] !== undefined) {
    const props = record['htmlProps'];
    if (!Array.isArray(props) || props.length > 8 || !props.every((name) => typeof name === 'string' && /^[A-Za-z_$][\w$]{0,99}$/.test(name))) {
      fail(where, 'htmlProps: expected at most eight prop names');
    }
    out['htmlProps'] = props;
  }
  if (record['setHtml'] !== undefined) {
    if (typeof record['setHtml'] !== 'boolean') {
      fail(where, 'setHtml: expected boolean');
    }
    out['setHtml'] = record['setHtml'];
  }
  if (record['hasRest'] !== undefined) {
    if (typeof record['hasRest'] !== 'boolean') {
      fail(where, 'hasRest: expected boolean');
    }
    out['hasRest'] = record['hasRest'];
  }
  return out as unknown as ScanComponent;
}

export function parseScanResult(input: unknown): ScanResult {
  const record = asRecord(input, 'root');
  const result: Record<string, unknown> = {
    pages: parseScanPages(record['pages']),
    pageFolders: asArray(record['pageFolders'], 'pageFolders', LIMITS.scanFoldersMax).map((folder, index) => asString(folder, `pageFolders[${index}]`)),
    layouts: asArray(record['layouts'], 'layouts', LIMITS.scanEntriesMax).map((entry, index) => parseComponent(entry, `layouts[${index}]`)),
    components: asArray(record['components'], 'components', LIMITS.scanEntriesMax).map((entry, index) => parseComponent(entry, `components[${index}]`)),
  };
  if (record['trailingSlash'] !== undefined) {
    result['trailingSlash'] = asString(record['trailingSlash'], 'trailingSlash');
  }
  if (record['lengthUnit'] !== undefined) {
    result['lengthUnit'] = parseLengthUnit(record['lengthUnit']);
  }
  for (const key of ['pagesFolder', 'astroConfig'] as const) {
    if (record[key] !== undefined) {
      const value = asString(record[key], key);
      if (value.length === 0 || value.startsWith('/') || value.split('/').includes('..')) {
        fail(key, 'expected a project-relative path');
      }
      result[key] = value;
    }
  }
  if (record['packageManager'] !== undefined) {
    const manager = PACKAGE_MANAGERS.find((candidate) => candidate === record['packageManager']);
    if (manager === undefined) {
      fail('packageManager', `expected ${PACKAGE_MANAGERS.join(', ')}`);
    }
    result['packageManager'] = manager;
  }
  if (record['warnings'] !== undefined) {
    result['warnings'] = parseScanWarnings(record['warnings']);
  }
  return result as unknown as ScanResult;
}

export function parseScanWarnings(input: unknown): readonly ScanWarning[] {
  return asArray(input, 'warnings', LIMITS.scanEntriesMax).map((entry, index) => parseScanWarning(entry, `warnings[${index}]`));
}

function parseScanWarning(input: unknown, where: string): ScanWarning {
  const record = asRecord(input, where);
  const code = SCAN_WARNING_CODES.find((candidate) => candidate === record['code']);
  if (code === undefined) {
    fail(`${where}.code`, `expected one of ${SCAN_WARNING_CODES.join(', ')}`);
  }
  const message = asString(record['message'], `${where}.message`);
  if (message.length === 0) {
    fail(`${where}.message`, 'expected a sentence naming the problem');
  }
  const file = record['file'] === undefined ? undefined : asString(record['file'], `${where}.file`);
  if (file !== undefined && (file.length === 0 || file.startsWith('/') || file.split('/').includes('..'))) {
    fail(`${where}.file`, 'expected a project-relative path');
  }
  const detail = record['detail'] === undefined ? undefined : asString(record['detail'], `${where}.detail`);
  return { code, message, ...(file === undefined ? {} : { file }), ...(detail === undefined ? {} : { detail }) };
}

export function parseScanPages(input: unknown): readonly ScanPage[] {
  return asArray(input, 'pages', LIMITS.scanEntriesMax).map((entry, index) => parsePage(entry, `pages[${index}]`));
}
