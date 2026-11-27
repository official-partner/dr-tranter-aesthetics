import type { Described } from './i18n/messageRef';

export class DescribedError extends Error {
  readonly problem: Described;
  constructor(problem: Described) {
    super(problem.message);
    this.problem = problem;
  }
}

export function problemOf(error: unknown): Described {
  if (error instanceof DescribedError) {
    return error.problem;
  }
  return { message: error instanceof Error ? error.message : String(error) };
}
