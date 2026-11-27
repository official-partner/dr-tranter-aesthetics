import type { ScanComponent } from '../../../shared/properties/projectScan';
import type { ImportDecl } from '../../../shared/page/pageNode';
import { resolveSourceImport } from '../../editor/importPaths';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';

interface ComponentReference {
  readonly name: string;
  readonly project: string | undefined;
  readonly file: string | undefined;
  readonly imports: readonly ImportDecl[];
  readonly components: readonly ScanComponent[];
}

export function componentReference(context: ComponentReference): ScanComponent | undefined {
  return importedComponent(context) ?? context.components.find((item) => item.name === context.name);
}

export function componentFileOf(context: ComponentReference): string | undefined {
  const imported = importedComponent(context);
  if (imported !== undefined) {
    return imported.path;
  }
  const named = context.components.filter((item) => item.name === context.name);
  return named.length === 1 ? named[0]?.path : undefined;
}

function importedComponent(context: ComponentReference): ScanComponent | undefined {
  const specifier = context.imports.find((item) => item.name === context.name)?.path;
  const installed = context.components.find((item) => item.origin?.kind === 'package' && item.origin.importPath === specifier);
  if (installed) {
    return installed;
  }
  const root = context.project?.replaceAll('\\', '/').replace(/\/$/, '');
  const file = context.file?.replaceAll('\\', '/');
  if (specifier && root && file?.startsWith(root + '/')) {
    const resolved = resolveSourceImport(file.slice(root.length + 1), specifier);
    if (resolved) {
      return context.components.find((item) => item.path.replaceAll('\\', '/') === root + '/' + resolved);
    }
  }
  return undefined;
}

interface ComponentUseNode {
  readonly kind: string;
  readonly name?: string;
  readonly dynamicTag?: boolean;
  readonly astroAsset?: boolean;
  readonly children?: readonly ComponentUseNode[] | undefined;
}

export function pageComponentFiles(nodes: readonly ComponentUseNode[], context: Omit<ComponentReference, 'name'>, limit: number): readonly string[] {
  assert(Number.isSafeInteger(limit), 'pageComponentFiles: the limit is an integer');
  assert(limit > 0, 'pageComponentFiles: the limit is positive');
  const names = new Set<string>();
  const stack: ComponentUseNode[] = [...nodes];
  for (let visited = 0; visited < LIMITS.treeNodesMax && stack.length > 0; visited += 1) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (node.kind === 'component' && node.name !== undefined && node.dynamicTag !== true && node.astroAsset !== true && node.name !== 'Fragment') {
      names.add(node.name);
    }
    stack.push(...(node.children ?? []));
  }
  const files: string[] = [];
  for (const name of names) {
    const file = componentFileOf({ ...context, name });
    if (file !== undefined && !files.includes(file)) {
      files.push(file);
    }
    if (files.length >= limit) {
      break;
    }
  }
  assert(files.length <= limit, 'pageComponentFiles: bounded by the limit');
  return files;
}
