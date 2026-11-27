import { assert } from '../../../../shared/core/assert';
import type { NameBlock } from '../../../../shared/properties/variableGroups';
import type { VariablesSnapshot } from '../../../ipc/variablesBridge';
import { declarationTextBefore } from './codeVariableScope';
import type { ProjectVariable } from './webflow';


export const PANEL_LISTING_MAX = 4_096;

export interface PanelListing {
  readonly variables: readonly ProjectVariable[];
  readonly blocks: ReadonlyMap<string, readonly NameBlock[]>;
}

export function panelBlockKey(collection: string, group: string): string {
  return `${collection}\u0000${group}`;
}

export function panelListing(
  snapshot: VariablesSnapshot,
  options: { readonly self: string | undefined; readonly known: readonly ProjectVariable[] },
): PanelListing {
  const typeOf = new Map(options.known.map((variable): [string, string] => [`--${variable.name}`, variable.type]));
  const variables: ProjectVariable[] = [];
  const blocks = new Map<string, NameBlock[]>();
  const seen = new Set<string>();
  for (const file of snapshot.files) {
    if (file.error !== undefined) {
      continue;
    }
    for (const group of file.groups) {
      const key = panelBlockKey(file.name, group.label);
      const held = blocks.get(key) ?? [];
      blocks.set(key, held);
      for (const block of group.blocks) {
        const names: string[] = [];
        for (const row of block.rows) {
          for (const cell of row.cells) {
            if (cell === undefined || cell.name === options.self || variables.length >= PANEL_LISTING_MAX) {
              continue;
            }
            const unique = `${key}\u0000${cell.name}`;
            if (seen.has(unique)) {
              continue;
            }
            seen.add(unique);
            names.push(cell.name);
            variables.push({
              collection: file.name,
              group: group.label,
              name: cell.name.replace(/^--/, ''),
              value: cell.value,
              binding: `var(${cell.name})`,
              type: typeOf.get(cell.name) ?? (cell.color === undefined ? 'Size' : 'Color'),
              file: file.rel,
            });
          }
        }
        if (names.length > 0) {
          held.push({ title: block.title, names });
        }
      }
    }
  }
  assert(variables.length <= PANEL_LISTING_MAX, 'panelListing: the listing is bounded');
  assert(
    options.self === undefined || variables.every((variable) => variable.binding !== `var(${options.self})`),
    'panelListing: the declared variable is never offered to itself',
  );
  return { variables, blocks };
}

export function declaredPropertyAt(text: string, offset: number): string | undefined {
  assert(offset >= 0, 'declaredPropertyAt: the offset is in the text');
  assert(offset <= text.length, 'declaredPropertyAt: the offset ends in the text');
  const before = text.slice(Math.max(0, offset - 4_096), offset);
  const declaration = declarationTextBefore(before);
  const colon = declaration.indexOf(':');
  if (colon < 0) {
    return undefined;
  }
  const property = declaration.slice(0, colon).trim();
  return /^--[A-Za-z0-9_-]+$/.test(property) ? property : undefined;
}
