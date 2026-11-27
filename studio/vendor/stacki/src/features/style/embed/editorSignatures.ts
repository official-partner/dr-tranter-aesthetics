
import { type RuleModel } from '../model/cascade';
import { listMatchedSelectors, selectorKey, type MatchedSelector, type StyleContext } from '../model/resolved';
import { nativeSelectorChips } from '../model/nativeStyles';
import { canonicalCompound, compareSpecificity } from '../model/selectors';
import { getHost, walkNodes, type HostNode } from '../model/host';
import type { ElementSnapshot, NativeModel, ParsedRule, Specificity } from '../model/styleTypes';
import { matchedTexts, type CanvasAsk } from '../model/canvasAsk';

export const BG_REFRESH_THROTTLE_MS = 4000;

export function sheetSignature(): string {
  const host = getHost();
  return [...host.files, ...host.astroFiles].map((file) => file.path).join('|') + `#${styleBlockIds(host.nodes)}`;
}

const styleBlockIdsOf = new WeakMap<readonly HostNode[], string>();
function styleBlockIds(nodes: readonly HostNode[]): string {
  const known = styleBlockIdsOf.get(nodes);
  if (known !== undefined) {
    return known;
  }
  const ids: string[] = [];
  walkNodes(nodes, (node) => {
    if (node.kind === 'raw' && node.name === 'style') {
      ids.push(node.id);
    }
  });
  const joined = ids.join(',');
  styleBlockIdsOf.set(nodes, joined);
  return joined;
}
export const DESIGNER_SYNC_INTERVAL_MS = 1500;

export const selectorKeyOf = (rules: ParsedRule[]): string => rules.map((rule) => rule.selectorText).join('\n');

export function snapshotSignature(snap: ElementSnapshot): string {
  return JSON.stringify([snap.tag, snap.id, snap.classes, snap.attributes]);
}
export function domMatchesChanged(shown: ReadonlyMap<string, boolean> | undefined, ask: CanvasAsk): boolean {
  if (shown === undefined || ask.kind !== 'asked' || ask.answer === undefined) {
    return false;
  }
  for (const [text, hit] of matchedTexts(ask)) {
    if (shown.get(text) !== hit) {
      return true;
    }
  }
  return false;
}

export function nativeSignature(model: NativeModel | undefined): string {
  if (!model) {
    return '';
  }
  return model.styles
    .map(
      (style) =>
        `${style.className}:${[...style.propsByContext]
          .map(
            ([contextKey, props]) =>
              `${contextKey}{${[...props].map(([prop, declared]) => `${prop}=${declared.value}${declared.isVariable ? '~' : ''}`).join(';')}}`,
          )
          .join('|')}`,
    )
    .join('||');
}

export function chainPrefixDepth(classes: string[], classList: string[]): number {
  const classCount = classes.length;
  if (!classCount || classCount > classList.length) {
    return 0;
  }
  const set = new Set(classes);
  if (set.size !== classCount) {
    return 0;
  }
  for (let i = 0; i < classCount; i += 1) {
    if (!set.has(classList[i] ?? '')) {
      return 0;
    }
  }
  return classCount;
}

export function selectorOrder(text: string, classList: string[]): [number, number, number] {
  const canon = canonicalCompound(text);
  const classes = canon.tokens.filter((token) => token.startsWith('class:')).map((token) => token.slice('class:'.length));
  const hasTag = canon.tokens.some((token) => token.startsWith('tag:'));
  const hasAttr = canon.tokens.some((token) => token.startsWith('attr:'));
  const pseudo = text.includes(':') ? 1 : 0;
  if (!canon.oneCompound) {
    return [4, 0, 0];
  }
  if (classes.length) {
    const depth = chainPrefixDepth(classes, classList);
    if (depth > 0) {
      return [1, depth, pseudo];
    }
    let applied = -1;
    for (const cls of classes) {
      const at = classList.indexOf(cls);
      if (at > applied) {
        applied = at;
      }
    }
    return [2, applied === -1 ? classList.length : applied, pseudo];
  }
  if (hasAttr) {
    return [3, 0, pseudo];
  }
  if (hasTag) {
    return [0, 0, 0];
  }
  return [4, 0, 0];
}

export function styledSelectorsFor(model: RuleModel | undefined, nativeModel: NativeModel | undefined, context: StyleContext): MatchedSelector[] {
  const byKey = new Map<string, MatchedSelector>();
  const add = (chip: MatchedSelector) => {
    if (!byKey.has(chip.key)) {
      byKey.set(chip.key, chip);
    }
  };
  if (model) {
    for (const matched of listMatchedSelectors(model, context.embedAtContext ?? ' native-only')) {
      add(matched);
    }
  }
  for (const ns of nativeSelectorChips(nativeModel, context.breakpoint ?? 'main')) {
    const key = selectorKey(ns.text);
    const inContext = context.breakpoint ? ns.inContext : false;
    const existing = byKey.get(key);
    if (existing) {
      if (inContext) {
        existing.inContext = true;
      }
      continue;
    }
    const specificity: Specificity = [0, ns.classDepth, 0];
    byKey.set(key, {
      text: ns.text,
      specificity,
      state: ns.state,
      simple: true,
      key,
      inContext,
      fromComponent: false,
    });
  }
  return [...byKey.values()].sort((left, right) => compareSpecificity(left.specificity, right.specificity) || left.text.localeCompare(right.text));
}
