
import { assert } from '../../../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../../../shared/properties/i18n/messageRef';
import { STATES, type NativeContribution, type StateKey, type StyleContext } from './resolved';
import type { BreakpointId, NativeModel } from './styleTypes';
import { nestedQueryOfKey, splitSourcedKey } from './queryWrapper';


export type NativeStyleOptions = { breakpoint?: BreakpointId; pseudo?: string };

export type BreakpointDefinition = {
  id: BreakpointId;
  label: string;
  labelKey: MessageKey;
  media: string | undefined;
};

export const BREAKPOINTS: readonly BreakpointDefinition[] = [
  { id: 'xxl', label: 'Desktop ≥1920', labelKey: 'styleModel.breakpoint.xxl', media: '(min-width: 1920px)' },
  { id: 'xl', label: 'Desktop ≥1440', labelKey: 'styleModel.breakpoint.xl', media: '(min-width: 1440px)' },
  { id: 'large', label: 'Desktop ≥1280', labelKey: 'styleModel.breakpoint.large', media: '(min-width: 1280px)' },
  { id: 'main', label: 'Base', labelKey: 'styleModel.breakpoint.main', media: undefined },
  { id: 'medium', label: 'Tablet', labelKey: 'styleModel.breakpoint.medium', media: '(max-width: 991px)' },
  { id: 'small', label: 'Mobile (L)', labelKey: 'styleModel.breakpoint.small', media: '(max-width: 767px)' },
  { id: 'tiny', label: 'Mobile', labelKey: 'styleModel.breakpoint.tiny', media: '(max-width: 479px)' },
];

function isBreakpointId(value: string): value is BreakpointId {
  return BREAKPOINTS.some((breakpoint) => breakpoint.id === value);
}


const PSEUDO_FOR_STATE: Record<StateKey, string | undefined> = {
  '': undefined,
  ':hover': 'hover',
  ':focus': 'focus',
  ':active': 'active',
};

export function breakpointLabel(id: BreakpointId, translate: Translator = ENGLISH_TRANSLATE): string {
  const definition = BREAKPOINTS.find((bp) => bp.id === id);
  return definition === undefined ? id : translate(definition.labelKey);
}

export const mediaParamsForBreakpoint = (id: BreakpointId): string | undefined => BREAKPOINTS.find((bp) => bp.id === id)?.media;

function compileClass(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, '')
    .replace(/\s+/g, '-');
}

function normalizeMedia(text: string): string {
  return text
    .replace(/^@media/i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}


export function nativeContextKey(breakpoint: BreakpointId, state: StateKey): string {
  return `${breakpoint}|${state}`;
}

export function breakpointForAtContext(atContext: string): BreakpointId | undefined {
  const norm = normalizeMedia(atContext);
  for (const bp of BREAKPOINTS) {
    if (bp.media && normalizeMedia(bp.media) === norm) {
      return bp.id;
    }
  }
  return undefined;
}

export function readOptionsFor(breakpoint: BreakpointId, state: StateKey): NativeStyleOptions | undefined {
  const options: NativeStyleOptions = {};
  if (breakpoint !== 'main') {
    options.breakpoint = breakpoint;
  }
  const pseudo = PSEUDO_FOR_STATE[state];
  if (pseudo) {
    options.pseudo = pseudo;
  }
  return Object.keys(options).length ? options : undefined;
}

export function optionsFor(context: StyleContext, state: StateKey): NativeStyleOptions | undefined {
  const options: NativeStyleOptions = {};
  if (context.breakpoint && context.breakpoint !== 'main') {
    options.breakpoint = context.breakpoint;
  }
  const pseudo = PSEUDO_FOR_STATE[state];
  if (pseudo) {
    options.pseudo = pseudo;
  }
  return Object.keys(options).length ? options : undefined;
}


export function nativeBreakpointsWithValues(model: NativeModel | undefined): Set<BreakpointId> {
  const out = new Set<BreakpointId>();
  if (!model) {
    return out;
  }
  for (const style of model.styles) {
    for (const [key, props] of style.propsByContext) {
      const breakpoint = key.split('|')[0];
      if (props.size && breakpoint && isBreakpointId(breakpoint)) {
        out.add(breakpoint);
      }
    }
  }
  return out;
}

export function nativeHasValues(model: NativeModel | undefined, breakpoint: BreakpointId): boolean {
  return nativeBreakpointsWithValues(model).has(breakpoint);
}

export function buildStyleContexts(
  embedContextKeys: string[],
  model: NativeModel | undefined,
  styledEmbedContexts: ReadonlySet<string> = new Set(),
  ownContexts: ReadonlySet<string> = new Set(),
  translate: Translator = ENGLISH_TRANSLATE,
): StyleContext[] {
  const list: StyleContext[] = [];
  const usedBp = new Set<BreakpointId>();

  const nativeBps = nativeBreakpointsWithValues(model);

  embedContextKeys.forEach((key) => {
    if (key === '') {
      list.push({ key: '', label: translate('styleModel.breakpoint.main'), breakpoint: 'main', embedAtContext: '' });
      usedBp.add('main');
      return;
    }
    const { placed, source } = splitSourcedKey(key);
    const sourced = source === undefined ? {} : { source };
    const nested = nestedQueryOfKey(key);
    if (nested !== undefined) {
      if (styledEmbedContexts.has(key)) {
        list.push({ key, label: nested.atContext, breakpoint: undefined, embedAtContext: nested.atContext, wrapper: nested.wrapper, ...sourced });
      }
      return;
    }
    const bp = breakpointForAtContext(placed);
    if (bp) {
      if (usedBp.has(bp)) {
        return;
      }
      if (!nativeBps.has(bp) && !styledEmbedContexts.has(key)) {
        return;
      }
      usedBp.add(bp);
      list.push({
        key: `bp:${bp}`,
        label: breakpointLabel(bp, translate),
        breakpoint: bp,
        embedAtContext: placed,
      });
    } else {
      if (!styledEmbedContexts.has(key)) {
        return;
      }
      list.push({ key, label: placed, breakpoint: undefined, embedAtContext: placed, ...sourced });
    }
  });

  for (const definition of BREAKPOINTS) {
    if (definition.id === 'main' || usedBp.has(definition.id)) {
      continue;
    }
    if (!nativeBps.has(definition.id)) {
      continue;
    }
    usedBp.add(definition.id);
    list.push({
      key: `bp:${definition.id}`,
      label: translate(definition.labelKey),
      breakpoint: definition.id,
      embedAtContext: undefined,
    });
  }

  assert(new Set(list.map((context) => context.key)).size === list.length, 'buildStyleContexts: every context is listed once');
  const ordered = list
    .map((context, index) => ({ context, index }))
    .sort((left, right) => rank(left.context, ownContexts) - rank(right.context, ownContexts) || left.index - right.index)
    .map((entry) => entry.context);
  assert(ordered.length === list.length, 'buildStyleContexts: ordering keeps every context');
  return ordered;
}

function rank(context: StyleContext, ownContexts: ReadonlySet<string>): number {
  if (context.key === '') {
    return -1;
  }
  if (context.breakpoint) {
    return BREAKPOINTS.findIndex((bp) => bp.id === context.breakpoint);
  }
  return ownContexts.has(context.key) ? 100 : 101;
}

export function breakpointCascade(target: BreakpointId): BreakpointId[] {
  const targetIndex = BREAKPOINTS.findIndex((bp) => bp.id === target);
  const mainIndex = BREAKPOINTS.findIndex((bp) => bp.id === 'main');
  if (targetIndex < 0 || targetIndex === mainIndex) {
    return ['main'];
  }
  const chain: BreakpointId[] = ['main'];
  const step = targetIndex > mainIndex ? 1 : -1;
  for (let i = mainIndex + step; i !== targetIndex + step; i += step) {
    const breakpoint = BREAKPOINTS[i];
    if (breakpoint === undefined) {
      throw new Error(`Breakpoint cascade index ${i} is outside its bounds`);
    }
    chain.push(breakpoint.id);
  }
  return chain;
}

export function breakpointTier(target: BreakpointId): number {
  return breakpointCascade(target).length - 1;
}

export function nativeContribsFor(model: NativeModel | undefined, context: StyleContext, state: StateKey): NativeContribution[] {
  if (!model) {
    return [];
  }
  const chain = breakpointCascade(context.breakpoint || 'main');
  const stateChain: StateKey[] = state ? ['', state] : [''];
  const out: NativeContribution[] = [];
  for (const style of model.styles) {
    const baseDepth = style.applied ? style.index + 1 : 1;
    const baseSelector = `.${style.namePath.map(compileClass).join('.')}`;
    chain.forEach((bp, bpTier) => {
      for (const st of stateChain) {
        const props = style.propsByContext.get(nativeContextKey(bp, st));
        if (!props) {
          continue;
        }
        const atState = st === state;
        const classDepth = baseDepth + (st ? 1 : 0);
        const selector = `${baseSelector}${st}`;
        props.forEach((native, prop) => {
          out.push({
            styleIndex: style.index,
            className: style.className,
            selector,
            prop,
            value: native.value,
            isVariable: native.isVariable,
            classDepth,
            bpTier,
            atState,
          });
        });
      }
    });
  }
  return out;
}

export type NativeSelectorChip = {
  text: string;
  classDepth: number;
  state: StateKey;
  inContext: boolean;
};

export function nativeSelectorChips(model: NativeModel | undefined, breakpoint: BreakpointId): NativeSelectorChip[] {
  if (!model) {
    return [];
  }
  const out: NativeSelectorChip[] = [];
  for (const style of model.styles) {
    const classDepth = style.applied ? style.index + 1 : 1;
    const base = `.${style.namePath.map(compileClass).join('.')}`;
    for (const state of STATES) {
      const hasAnywhere = BREAKPOINTS.some((bp) => {
        const props = style.propsByContext.get(nativeContextKey(bp.id, state));
        return !!(props && props.size);
      });
      if (!hasAnywhere) {
        continue;
      }
      const here = style.propsByContext.get(nativeContextKey(breakpoint, state));
      out.push({ text: `${base}${state}`, classDepth, state, inContext: !!(here && here.size) });
    }
  }
  return out;
}

function pickedClassNames(selectedTokens: string[]): string[] | undefined {
  const names: string[] = [];
  for (const token of selectedTokens) {
    if (!token.startsWith('class:')) {
      return undefined;
    }
    names.push(compileClass(token.slice('class:'.length)));
  }
  return names.length ? names : undefined;
}

export function selectedNativeIndexFor(model: NativeModel | undefined, selectedTokens: string[]): number | undefined {
  if (!model) {
    return undefined;
  }
  const picked = pickedClassNames(selectedTokens);
  if (!picked) {
    return undefined;
  }
  const pickedSet = new Set(picked);

  const applied = model.styles.filter((style) => style.applied);
  for (let i = 0; i < applied.length; i += 1) {
    if (i + 1 !== pickedSet.size) {
      continue;
    }
    const chain = new Set(applied.slice(0, i + 1).map((style) => style.className));
    if (chain.size === pickedSet.size && [...pickedSet].every((name) => chain.has(name))) {
      const style = applied[i];
      if (style === undefined) {
        throw new Error(`Applied style index ${i} is outside its bounds`);
      }
      return model.styles.indexOf(style);
    }
  }

  if (pickedSet.size === 1) {
    const [name] = [...pickedSet];
    const standalone = model.styles.find((style) => !style.applied && style.className === name);
    if (standalone) {
      return model.styles.indexOf(standalone);
    }
  }
  return undefined;
}
