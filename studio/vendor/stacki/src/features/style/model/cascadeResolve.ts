
import { compareLayerPositions, type LayerPosition } from './cascadeLayers';
import { compareSpecificity } from './selectorParse';
import type { Specificity } from './styleTypes';

export type CascadeCandidate = {
  readonly important: boolean;
  readonly inline?: boolean;
  readonly layer?: LayerPosition | undefined;
  readonly specificity: Specificity;
  readonly order: number;
  readonly applies?: boolean;
};

export type LossKind = 'condition' | 'importance' | 'inline' | 'layer' | 'specificity' | 'order' | 'other';

export const LOSS_KINDS: readonly LossKind[] = ['condition', 'importance', 'inline', 'layer', 'specificity', 'order', 'other'];

function layerPrecedence(left: CascadeCandidate, right: CascadeCandidate): number {
  const important = left.important;
  if (left.layer === undefined && right.layer === undefined) {
    return 0;
  }
  if (left.layer === undefined) {
    return important ? -1 : 1;
  }
  if (right.layer === undefined) {
    return important ? 1 : -1;
  }
  const later = compareLayerPositions(left.layer, right.layer);
  return important ? -later : later;
}

function decidingStep(left: CascadeCandidate, right: CascadeCandidate): { readonly kind: Exclude<LossKind, 'other'>; readonly favors: -1 | 1 } | undefined {
  const leftApplies = left.applies !== false;
  const rightApplies = right.applies !== false;
  if (leftApplies !== rightApplies) {
    return { kind: 'condition', favors: leftApplies ? -1 : 1 };
  }
  if (left.important !== right.important) {
    return { kind: 'importance', favors: left.important ? -1 : 1 };
  }
  const leftInline = left.inline === true;
  const rightInline = right.inline === true;
  if (leftInline !== rightInline) {
    return { kind: 'inline', favors: leftInline ? -1 : 1 };
  }
  const layer = layerPrecedence(left, right);
  if (layer !== 0) {
    return { kind: 'layer', favors: layer > 0 ? -1 : 1 };
  }
  const specificity = compareSpecificity(left.specificity, right.specificity);
  if (specificity !== 0) {
    return { kind: 'specificity', favors: specificity > 0 ? -1 : 1 };
  }
  if (left.order !== right.order) {
    return { kind: 'order', favors: left.order > right.order ? -1 : 1 };
  }
  return undefined;
}

export function compareCandidates(left: CascadeCandidate, right: CascadeCandidate): number {
  return decidingStep(left, right)?.favors ?? 0;
}

export function explainLoss(loser: CascadeCandidate, winner: CascadeCandidate): LossKind | undefined {
  const step = decidingStep(loser, winner);
  if (step === undefined || step.favors === -1) {
    return undefined;
  }
  return step.kind;
}

export function rankCandidates<Candidate extends CascadeCandidate>(candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => compareCandidates(left.candidate, right.candidate) || left.index - right.index)
    .map((entry) => entry.candidate);
}
