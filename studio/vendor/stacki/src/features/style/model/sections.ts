
import type { MessageKey } from '../../../../shared/properties/i18n/messageRef';
import type { ParsedDeclaration } from './styleTypes';

export type SectionId = 'flex-child' | 'layout' | 'size' | 'spacing' | 'position' | 'typography' | 'backgrounds' | 'borders' | 'effects' | 'other';

export type SectionDefinition = {
  id: SectionId;
  label: string;
  labelKey: MessageKey;
  order: readonly string[];
};

export const SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'flex-child',
    label: 'Flex/Grid Child',
    labelKey: 'styleModel.sections.flexChild',
    order: [
      'flex',
      'flex-grow',
      'flex-shrink',
      'flex-basis',
      'grid-area',
      'grid-column',
      'grid-column-start',
      'grid-column-end',
      'grid-row',
      'grid-row-start',
      'grid-row-end',
      'align-self',
      'justify-self',
      'order',
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    labelKey: 'styleModel.sections.layout',
    order: [
      'display',
      'vertical-align',
      'flex-direction',
      'flex-wrap',
      'flex-flow',
      'justify-content',
      'align-items',
      'align-content',
      'place-content',
      'gap',
      'row-gap',
      'column-gap',
      'grid-gap',
      'grid-row-gap',
      'grid-column-gap',
      'grid-template-columns',
      'grid-template-rows',
      'grid-template-areas',
      'grid-auto-flow',
      'grid-auto-columns',
      'grid-auto-rows',
      'justify-items',
      'place-self',
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    labelKey: 'styleModel.sections.spacing',
    order: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  },
  {
    id: 'size',
    label: 'Size',
    labelKey: 'styleModel.sections.size',
    order: [
      'width',
      'height',
      'min-width',
      'max-width',
      'min-height',
      'max-height',
      'overflow',
      'overflow-x',
      'overflow-y',
      'aspect-ratio',
      'box-sizing',
      'object-fit',
      'object-position',
    ],
  },
  {
    id: 'position',
    label: 'Position',
    labelKey: 'styleModel.sections.position',
    order: ['position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear'],
  },
  {
    id: 'typography',
    label: 'Typography',
    labelKey: 'styleModel.sections.typography',
    order: [
      'color',
      'font-family',
      'font-weight',
      'font-size',
      'line-height',
      'text-align',
      'text-decoration',
      'text-decoration-line',
      'text-decoration-style',
      'text-decoration-color',
      'text-decoration-thickness',
      'text-decoration-skip-ink',
      'text-transform',
      'font-style',
      'letter-spacing',
      'text-indent',
      'columns',
      'column-count',
      'column-gap',
      'column-rule',
      'column-rule-style',
      'column-rule-width',
      'column-rule-color',
      'column-span',
      'white-space',
      'word-break',
      'overflow-wrap',
      'text-overflow',
      'text-wrap',
      '-webkit-text-stroke',
      '-webkit-text-stroke-width',
      '-webkit-text-stroke-color',
      'text-shadow',
      'direction',
    ],
  },
  {
    id: 'backgrounds',
    label: 'Backgrounds',
    labelKey: 'styleModel.sections.backgrounds',
    order: [
      'background',
      'background-color',
      'background-image',
      'background-position',
      'background-size',
      'background-repeat',
      'background-attachment',
      'background-clip',
      'background-origin',
    ],
  },
  {
    id: 'borders',
    label: 'Borders',
    labelKey: 'styleModel.sections.borders',
    order: [
      'border-radius',
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
      'border',
      'border-width',
      'border-style',
      'border-color',
      'border-top',
      'border-right',
      'border-bottom',
      'border-left',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-right-width',
      'border-right-style',
      'border-right-color',
      'border-bottom-width',
      'border-bottom-style',
      'border-bottom-color',
      'border-left-width',
      'border-left-style',
      'border-left-color',
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    labelKey: 'styleModel.sections.effects',
    order: [
      'mix-blend-mode',
      'opacity',
      'outline',
      'outline-style',
      'outline-width',
      'outline-color',
      'outline-offset',
      'box-shadow',
      'transform',
      'transform-origin',
      'transform-style',
      'perspective',
      'perspective-origin',
      'backface-visibility',
      'transition',
      'transition-property',
      'transition-duration',
      'transition-timing-function',
      'transition-delay',
      'filter',
      'backdrop-filter',
      'clip-path',
      '-webkit-clip-path',
      'cursor',
      'pointer-events',
    ],
  },
  { id: 'other', label: 'Other properties', labelKey: 'styleModel.sections.other', order: [] },
];

export const PROPERTY_SECTION: ReadonlyMap<string, SectionId> = (() => {
  const map = new Map<string, SectionId>();
  for (const section of SECTIONS) {
    for (const prop of section.order) {
      map.set(prop, section.id);
    }
  }
  return map;
})();

export const PROPERTY_ORDER: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  for (const section of SECTIONS) {
    section.order.forEach((prop, index) => map.set(prop, index));
  }
  return map;
})();

const NO_CONTROL: ReadonlySet<string> = new Set([
  'inset',
  'grid-area',
  'outline',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'columns',
  'column-rule',
]);

export function sectionOf(prop: string): SectionId {
  if (NO_CONTROL.has(prop)) {
    return 'other';
  }
  return PROPERTY_SECTION.get(prop) ?? 'other';
}

export type SectionGroup = {
  def: SectionDefinition;
  decls: ParsedDeclaration[];
};

const UNRANKED = Number.MAX_SAFE_INTEGER;

export function groupDeclarations(decls: ParsedDeclaration[], alwaysShow: readonly SectionId[] = []): SectionGroup[] {
  const buckets = new Map<SectionId, ParsedDeclaration[]>();
  decls.forEach((decl) => {
    const id = sectionOf(decl.prop);
    const list = buckets.get(id);
    if (list) {
      list.push(decl);
    } else {
      buckets.set(id, [decl]);
    }
  });

  const groups: SectionGroup[] = [];
  for (const definition of SECTIONS) {
    const list = buckets.get(definition.id) ?? [];
    const has = list.length > 0;
    if (!has && !alwaysShow.includes(definition.id)) {
      continue;
    }
    if (has && definition.id !== 'other') {
      list
        .map((decl, index) => ({ decl, index, rank: PROPERTY_ORDER.get(decl.prop) ?? UNRANKED }))
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .forEach((entry, i) => {
          list[i] = entry.decl;
        });
    }
    groups.push({ def: definition, decls: list });
  }
  return groups;
}

export type SectionPropGroup = { def: SectionDefinition; props: string[] };

export function groupProps(propNames: string[], alwaysShow: readonly SectionId[] = []): SectionPropGroup[] {
  const buckets = new Map<SectionId, string[]>();
  propNames.forEach((prop) => {
    const id = sectionOf(prop);
    const list = buckets.get(id);
    if (list) {
      list.push(prop);
    } else {
      buckets.set(id, [prop]);
    }
  });

  const groups: SectionPropGroup[] = [];
  for (const definition of SECTIONS) {
    const list = buckets.get(definition.id) ?? [];
    const has = list.length > 0;
    if (!has && !alwaysShow.includes(definition.id)) {
      continue;
    }
    if (has && definition.id !== 'other') {
      list
        .map((prop, index) => ({ prop, index, rank: PROPERTY_ORDER.get(prop) ?? UNRANKED }))
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .forEach((entry, i) => {
          list[i] = entry.prop;
        });
    }
    groups.push({ def: definition, props: list });
  }
  return groups;
}
