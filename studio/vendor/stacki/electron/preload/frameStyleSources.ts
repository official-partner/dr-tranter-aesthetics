import type { StyleSource } from '../../shared/properties/styleSource';
import { inspectAuthoredProperties } from './frameAuthoredStyles';
import { ownClasses } from './frameMeasure';
import { inScope, pathsOf } from './frameRegions';

export function queryAuthoredStyles(element: Element, properties: readonly string[], target: 'element' | 'text') {
  const inspection = inspectAuthoredProperties(element, properties);
  const inheritedSources: Record<string, StyleSource> = {};
  for (const [property, source] of Object.entries(inspection.sources)) {
    if (source === undefined) {
      continue;
    }
    if (target === 'element' && source === element) {
      continue;
    }
    const classes = ownClasses(source);
    const label = source.id ? `#${source.id}` : classes.map((name) => `.${name}`).join('');
    const path = pathsOf(source)
      .filter(inScope)
      .sort((first, second) => second.length - first.length)[0];
    inheritedSources[property] = {
      label: label || source.tagName.toLowerCase(),
      ...(path === undefined ? {} : { path }),
    };
  }
  return { authoredProps: inspection.values, inheritedSources, authoredOrigins: inspection.origins };
}
