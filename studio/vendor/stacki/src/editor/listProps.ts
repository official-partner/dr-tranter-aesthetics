
import { assert } from '../../shared/core/assert';
import type { LoopSource } from './loopQuery';
import { parseFrontmatter, parseModule } from './loopSyntax';
import { LOOP_SETTINGS, readOptionsQuery, type LoopSetting } from './optionsQuery';

export interface ListProp {
  readonly setting: LoopSetting;
  readonly source: LoopSource;
  readonly defaultCode: string;
}

export function listPropsOf(componentFrontmatter: string): ReadonlyMap<string, ListProp> {
  const module = parseModule(componentFrontmatter);
  const frontmatter = parseFrontmatter(componentFrontmatter);
  const importedFrom = (local: string, spec: string): string | undefined =>
    module.imports.find((entry) => entry.name === local && entry.path === spec)?.imported;
  const found = new Map<string, ListProp>();
  for (const declaration of frontmatter.declarations.values()) {
    const read = declaration.init === undefined ? undefined : readOptionsQuery(declaration.init, { frontmatter, importedFrom });
    if (read === undefined) {
      continue;
    }
    for (const setting of LOOP_SETTINGS) {
      const home = read.home.settings[setting];
      if (home.kind === 'prop' && !found.has(home.key)) {
        const defaultCode = componentFrontmatter.slice(home.literal.from, home.literal.to);
        assert(defaultCode.length > 0, 'A list prop has a default');
        found.set(home.key, { setting, source: read.query.source, defaultCode });
      }
    }
  }
  assert(found.size <= LOOP_SETTINGS.length * frontmatter.declarations.size, 'List props are bounded by the lists');
  return found;
}
