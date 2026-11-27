
import { onCanvasReady } from '../../../editor/canvasQuery';
import type { WinningDeclarationText } from '../../../../shared/properties/winningDeclaration';

export interface DefinedAnswer {
  readonly names: ReadonlyMap<string, string>;
  readonly winning: ReadonlyMap<string, WinningDeclarationText>;
  readonly scoped: ReadonlyMap<string, WinningDeclarationText>;
}

const ANSWERS_MAX = 16;
const ANSWERS = new Map<string, DefinedAnswer>();

export function cachedAnswer(key: string): DefinedAnswer | undefined {
  return ANSWERS.get(key);
}

export function rememberAnswer(key: string, answer: DefinedAnswer): void {
  ANSWERS.delete(key);
  ANSWERS.set(key, answer);
  for (const oldest of ANSWERS.keys()) {
    if (ANSWERS.size <= ANSWERS_MAX) {
      break;
    }
    ANSWERS.delete(oldest);
  }
}

export function forgetDefinedAnswers(): void {
  ANSWERS.clear();
}

onCanvasReady(forgetDefinedAnswers);
