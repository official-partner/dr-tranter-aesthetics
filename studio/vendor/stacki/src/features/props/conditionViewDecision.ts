
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { Attr } from '../../../shared/page/pageNode';

export type ConditionView = 'visual' | 'code';

export type ConditionViewRefusal = 'complex';

export interface ConditionViewInput {
  readonly source: string;
  readonly readable: (source: string) => boolean;
  readonly chosen: ConditionView | undefined;
}

export interface ConditionViewDecision {
  readonly view: ConditionView;
  readonly note: ConditionViewRefusal | undefined;
  readonly visualRefusal: ConditionViewRefusal | undefined;
}

export function decideConditionView(input: ConditionViewInput): ConditionViewDecision {
  assert(input.source.length <= LIMITS.attrCharsMax, 'decideConditionView: source limit exceeded');
  if (input.readable(input.source)) {
    return { view: input.chosen === 'code' ? 'code' : 'visual', note: undefined, visualRefusal: undefined };
  }
  return { view: 'code', note: 'complex', visualRefusal: 'complex' };
}

export const CONTROLS_DECISION: ConditionViewDecision = { view: 'visual', note: undefined, visualRefusal: undefined };

export type AppliedCode = { readonly kind: 'unchanged' } | { readonly kind: 'write'; readonly value: Attr };

export function appliedCode(code: string, before: Attr | undefined): AppliedCode {
  assert(code.length <= LIMITS.attrCharsMax, 'appliedCode: code limit exceeded');
  const text = code.trim();
  if (text === '' || (before?.type === 'expr' && before.value.trim() === text)) {
    return { kind: 'unchanged' };
  }
  return { kind: 'write', value: { type: 'expr', value: text } };
}
