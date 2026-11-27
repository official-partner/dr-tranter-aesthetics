
import { assert } from '../../../../shared/core/assert';

export const ACTIVE_QUERY_AVAILABLE_MAX = 512;

export interface ActiveQueryInput {
  readonly previous: string;
  readonly available: readonly string[];
  readonly followedKey: string | undefined;
}

export function resolveActiveQuery(input: ActiveQueryInput): string {
  assert(input.available.length <= ACTIVE_QUERY_AVAILABLE_MAX, 'resolveActiveQuery: the available list is within its bound');
  if (input.previous === '') {
    return '';
  }
  if (input.available.includes(input.previous)) {
    return input.previous;
  }
  const followed = input.followedKey;
  if (followed !== undefined && followed !== '' && input.available.includes(followed)) {
    return followed;
  }
  return '';
}
