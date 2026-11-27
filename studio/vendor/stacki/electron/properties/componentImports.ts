import fs from 'node:fs';
import { assert } from '../../shared/core/assert';
import path from 'node:path';
import { aliasMap } from '../content/cmsRefs';
import { packageComponentImport } from '../lib/componentSources';
import { isPathDescendant } from '../lib/platform';

export function componentSpecifier(root: string, file: string): string | undefined {
  const installed = packageComponentImport(root, file);
  if (installed !== undefined) {
    return installed;
  }
  const absolute = path.resolve(root, file);
  const aliases = aliasMap(root);
  for (const alias of aliases) {
    if (!alias.wildcard) {
      continue;
    }
    for (const target of alias.targets) {
      const relative = path.relative(target, absolute).split(path.sep).join('/');
      if (relative.startsWith('../') || path.isAbsolute(relative)) {
        continue;
      }
      const specifier = alias.prefix + relative;
      const effective = aliases.find((entry) => (entry.wildcard ? specifier.startsWith(entry.prefix) : specifier === entry.prefix));
      const resolved = effective?.targets
        .map((directory) => path.resolve(directory, specifier.slice(effective.prefix.length)))
        .find((candidate) => fs.existsSync(candidate));
      if (resolved !== undefined && fs.realpathSync(resolved) === fs.realpathSync(absolute)) {
        return specifier;
      }
    }
  }
  return undefined;
}

export function componentImportPaths(input: { readonly pagePath: string; readonly targetPath: string; readonly projectPath?: string | undefined }): {
  readonly relative: string;
  readonly srcRelative: string | undefined;
} {
  const { pagePath, targetPath, projectPath } = input;
  const preferred = projectPath ? componentSpecifier(projectPath, targetPath) : undefined;
  if (preferred !== undefined) {
    return { relative: preferred, srcRelative: undefined };
  }
  const rel = path.relative(path.dirname(pagePath), targetPath).split(path.sep).join('/');
  const relative = rel.startsWith('.') ? rel : './' + rel;
  let sourceRelative: string | undefined = undefined;
  if (projectPath) {
    const sourceDirectory = path.join(projectPath, 'src');
    if (isPathDescendant(sourceDirectory, targetPath)) {
      sourceRelative = path.relative(sourceDirectory, targetPath).split(path.sep).join('/');
    }
  }
  assert(relative.startsWith('.'), 'componentImportPaths: a relative import starts with a dot');
  assert(!relative.includes('\\'), 'componentImportPaths: an import uses forward slashes');
  return { relative, srcRelative: sourceRelative };
}
