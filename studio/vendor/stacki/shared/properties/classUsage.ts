
import { assert } from '../core/assert';
import { list, record, text } from '../core/boundary';

export const CLASS_USAGE_LIMITS = {
  classesMax: 500,
  filesPerClassMax: 10,
  classCharsMax: 256,
  fileCharsMax: 1024,
} as const satisfies Record<string, number>;

export interface ClassUsage {
  readonly name: string;
  readonly files: readonly string[];
}

export interface ClassUsageReply {
  readonly classes: readonly ClassUsage[];
}

export function parseClassUsageNames(input: unknown): readonly string[] {
  const names = list(className)(input);
  if (names.length > CLASS_USAGE_LIMITS.classesMax) {
    throw new Error('Class usage: too many classes');
  }
  if (new Set(names).size !== names.length) {
    throw new Error('Class usage: a class is asked about twice');
  }
  assert(names.length <= CLASS_USAGE_LIMITS.classesMax, 'parseClassUsageNames: the question is within its bound');
  return names;
}

export function parseClassUsageReply(input: unknown): ClassUsageReply {
  const value = record(input);
  const classes = list(classUsage)(value['classes']);
  if (classes.length > CLASS_USAGE_LIMITS.classesMax) {
    throw new Error('Class usage: too many classes');
  }
  if (new Set(classes.map((entry) => entry.name)).size !== classes.length) {
    throw new Error('Class usage: a class is answered twice');
  }
  assert(
    classes.every((entry) => entry.files.length <= CLASS_USAGE_LIMITS.filesPerClassMax),
    'parseClassUsageReply: every class names files within its bound',
  );
  return { classes };
}

function classUsage(input: unknown): ClassUsage {
  const value = record(input);
  const files = list(relativeFile)(value['files']);
  if (files.length > CLASS_USAGE_LIMITS.filesPerClassMax) {
    throw new Error('Class usage: too many files for one class');
  }
  assert(new Set(files).size <= files.length, 'classUsage: a set of the files is no larger than the list');
  return { name: className(value['name']), files };
}

function className(input: unknown): string {
  const name = text(input);
  if (name.length === 0 || name.length > CLASS_USAGE_LIMITS.classCharsMax) {
    throw new Error('Class usage: a class name is 1 to 256 characters');
  }
  if (/\s/.test(name)) {
    throw new Error('Class usage: a class name has no whitespace');
  }
  assert(name.length > 0, 'className: a parsed class name is non-empty');
  return name;
}

function relativeFile(input: unknown): string {
  const file = text(input);
  if (file.length === 0 || file.length > CLASS_USAGE_LIMITS.fileCharsMax) {
    throw new Error('Class usage: a file path is 1 to 1024 characters');
  }
  if (file.startsWith('/')) {
    throw new Error('Class usage: a file path is relative to the project');
  }
  assert(file.length <= CLASS_USAGE_LIMITS.fileCharsMax, 'relativeFile: a parsed path is within its bound');
  return file;
}
