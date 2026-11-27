import { assert } from '../core/assert';
import { count, list, object, pathText, text } from '../core/boundary';

export const COMPONENT_REMOVAL_LIMITS = {
  previewFilesMax: 512,
  reviewsMax: 256,
} as const satisfies Record<string, number>;

export interface ComponentRemovalFile {
  readonly path: string;
  readonly count: number;
}

export const COMPONENT_REMOVAL_REVIEW_KINDS = ['dynamic-import', 'glob', 're-export', 'value', 'expression', 'content', 'layout', 'unreadable'] as const;
export type ComponentRemovalReviewKind = (typeof COMPONENT_REMOVAL_REVIEW_KINDS)[number];

export interface ComponentRemovalReview {
  readonly kind: ComponentRemovalReviewKind;
  readonly path: string;
  readonly line: number;
}

export interface ComponentRemovalPreview {
  readonly name: string;
  readonly files: number;
  readonly instances: readonly ComponentRemovalFile[];
  readonly imports: readonly ComponentRemovalFile[];
  readonly settings: readonly string[];
  readonly reviews: readonly ComponentRemovalReview[];
}

export function componentRemovalBlocked(preview: ComponentRemovalPreview): boolean {
  return preview.reviews.length > 0;
}

export function componentRemovalTotal(files: readonly ComponentRemovalFile[]): number {
  const total = files.reduce((sum, file) => sum + file.count, 0);
  assert(Number.isSafeInteger(total), 'A removal counts a safe number of places');
  return total;
}

export function parseComponentRemovalPreview(input: unknown): ComponentRemovalPreview {
  const preview = object({
    name: text,
    files: count,
    instances: list(parseFile),
    imports: list(parseFile),
    settings: list(pathText),
    reviews: list(parseReview),
  })(input);
  if (preview.name.trim() === '') {
    throw new Error('Component removal: a preview names the component');
  }
  if (preview.files === 0) {
    throw new Error('Component removal: a deletion removes at least one file');
  }
  if (preview.instances.length > COMPONENT_REMOVAL_LIMITS.previewFilesMax) {
    throw new Error('Component removal: too many instance files');
  }
  if (preview.imports.length > COMPONENT_REMOVAL_LIMITS.previewFilesMax) {
    throw new Error('Component removal: too many import files');
  }
  if (preview.reviews.length > COMPONENT_REMOVAL_LIMITS.reviewsMax) {
    throw new Error('Component removal: too many places to review');
  }
  return preview;
}

function parseFile(input: unknown): ComponentRemovalFile {
  const file = object({ path: pathText, count })(input);
  if (file.count === 0) {
    throw new Error('Component removal: a listed file is edited at least once');
  }
  return file;
}

function parseReview(input: unknown): ComponentRemovalReview {
  const review = object({ kind: reviewKind, path: pathText, line: count })(input);
  if (review.line === 0) {
    throw new Error('Component removal review: lines are 1-based');
  }
  return review;
}

function reviewKind(input: unknown): ComponentRemovalReviewKind {
  const kind = COMPONENT_REMOVAL_REVIEW_KINDS.find((candidate) => candidate === input);
  if (kind === undefined) {
    throw new Error('Component removal review: unknown kind');
  }
  return kind;
}
