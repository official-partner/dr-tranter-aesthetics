import { assert } from '../core/assert';
import { list, object, record, text } from '../core/boundary';
import { parseComponentPath } from './componentAccess';
import { RESERVED_COMPONENT_NAMES, isComponentFileName } from './componentNaming';

export { RESERVED_COMPONENT_NAMES };
export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !RESERVED_COMPONENT_NAMES.has(name);
}

export interface ComponentRenameRequest {
  readonly from: string;
  readonly to: string;
}

export function parseComponentRenameRequest(input: unknown): ComponentRenameRequest {
  const value = record(input);
  const from = parseComponentPath(value['from']);
  const to = parseComponentPath(value['to']);
  for (const file of [from, to]) {
    if (!file.endsWith('.astro')) {
      throw new Error('A component file ends in .astro');
    }
  }
  const name = to.slice(to.lastIndexOf('/') + 1, -'.astro'.length);
  if (!isComponentFileName(name)) {
    throw new Error(`"${name}" is not a component name`);
  }
  return { from, to };
}

export type RenameDirection = 'undo' | 'redo';

export function parseRenameDirection(input: unknown): RenameDirection {
  if (input === 'undo' || input === 'redo') {
    return input;
  }
  throw new Error('A rename is undone or redone');
}

export const RENAME_FILE_KINDS = ['component', 'page', 'layout', 'code', 'settings', 'content'] as const;
export type RenameFileKind = (typeof RENAME_FILE_KINDS)[number];

export const RENAME_NOTICE_KINDS = ['unparsed', 'kept-local-name', 'mention', 'namespace'] as const;
export type RenameNoticeKind = (typeof RENAME_NOTICE_KINDS)[number];

export interface RenameFileChange {
  readonly file: string;
  readonly kind: RenameFileKind;
}

export interface RenameNotice {
  readonly file: string;
  readonly kind: RenameNoticeKind;
}

export interface ComponentRenameSummary {
  readonly from: string;
  readonly to: string;
  readonly files: readonly RenameFileChange[];
  readonly notices: readonly RenameNotice[];
}

export const COMPONENT_RENAME_LIMITS = {
  undoEntriesMax: 16,
} as const satisfies Record<string, number>;

function oneOf<T extends string>(values: readonly T[], what: string): (input: unknown) => T {
  return (input) => {
    const found = values.find((value) => value === input);
    if (found === undefined) {
      throw new Error(`Unknown ${what}`);
    }
    return found;
  };
}

const parseFileChange = object({ file: text, kind: oneOf(RENAME_FILE_KINDS, 'rename file kind') });
const parseNotice = object({ file: text, kind: oneOf(RENAME_NOTICE_KINDS, 'rename notice kind') });

export function parseComponentRenameSummary(input: unknown): ComponentRenameSummary {
  const value = record(input);
  const files = list(parseFileChange)(value['files']);
  const notices = list(parseNotice)(value['notices']);
  assert(files.length >= 0, 'A summary lists its files');
  return { from: text(value['from']), to: text(value['to']), files, notices };
}

export function parseComponentRenameApplied(input: unknown): ComponentRenameSummary & { readonly undo: string } {
  const value = record(input);
  return { ...parseComponentRenameSummary(input), undo: text(value['undo']) };
}
