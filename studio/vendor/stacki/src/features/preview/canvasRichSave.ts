import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { CanvasTextBreaks } from '../../../shared/properties/canvasText';
import type { CanvasSourceNode } from './canvasTextSource';

export type RichWritten = 'written' | 'unchanged' | 'conflict' | 'refused' | 'busy';

export const RICH_SAVE_RETRY = { triesMax: 50, intervalMs: 100 } as const;
const RICH_BASES_MAX = 16;

export interface CanvasRichEdit {
  readonly edit: string;
  readonly file: string;
  readonly root: string;
  readonly breaks: CanvasTextBreaks;
}

export interface CanvasRichSave extends CanvasRichEdit {
  readonly html: string;
  readonly base: string;
}

export interface CanvasRichDocument {
  readonly file: string;
  readonly nodes: readonly CanvasSourceNode[];
  readonly pathFor: (id: string) => string | undefined;
  readonly format?:
    | {
        readonly contentOwner?: (textId: string, breaks: CanvasTextBreaks | undefined) => string | undefined;
        readonly content?: (ownerId: string) => string | undefined;
        readonly richText?: (ownerId: string, html: string, bases: readonly string[]) => RichWritten;
      }
    | undefined;
}

export interface CanvasRichSaveHost {
  readonly document: () => CanvasRichDocument | undefined;
  readonly refused: (why: 'conflict' | 'refused', save: CanvasRichSave) => void;
  readonly unchanged: (save: CanvasRichSave) => void;
  readonly wait: (delayMs: number) => Promise<void>;
}

export function createCanvasRichSaver(): {
  readonly opened: (edit: CanvasRichEdit, document: CanvasRichDocument | undefined) => void;
  readonly save: (save: CanvasRichSave, host: CanvasRichSaveHost) => Promise<void>;
} {
  const bases = new Map<string, string>();
  const attempt = async (save: CanvasRichSave, host: CanvasRichSaveHost): Promise<void> => {
    for (let tries = 0; tries <= RICH_SAVE_RETRY.triesMax; tries++) {
      const outcome = writeRichText(save, host.document(), bases.get(save.edit));
      switch (outcome) {
        case 'written':
          return;
        case 'unchanged':
          host.unchanged(save);
          return;
        case 'conflict':
        case 'refused':
          host.refused(outcome, save);
          return;
        case 'busy':
          await host.wait(RICH_SAVE_RETRY.intervalMs);
          break;
        default: {
          const exhaustive: never = outcome;
          return exhaustive;
        }
      }
    }
    host.refused('refused', save);
  };
  return {
    opened: (edit, document) => {
      if (bases.has(edit.edit)) {
        return;
      }
      const owner = document === undefined ? undefined : richOwnerOf(edit, document);
      const content = owner === undefined ? undefined : document?.format?.content?.(owner);
      if (content !== undefined) {
        bases.set(edit.edit, content);
        const oldest = bases.keys().next().value;
        if (bases.size > RICH_BASES_MAX && oldest !== undefined) {
          bases.delete(oldest);
        }
      }
    },
    save: (save, host) => attempt(save, host),
  };
}

function writeRichText(save: CanvasRichSave, document: CanvasRichDocument | undefined, opened: string | undefined): RichWritten {
  if (document === undefined) {
    return 'busy';
  }
  if (document.file !== save.file || document.format?.richText === undefined) {
    return 'refused';
  }
  const owner = richOwnerOf(save, document);
  if (owner === undefined) {
    return 'busy';
  }
  return document.format.richText(owner, save.html, opened === undefined ? [save.base] : [save.base, opened]);
}

export function richOwnerOf(edit: CanvasRichEdit, document: CanvasRichDocument): string | undefined {
  const pending: CanvasSourceNode[] = [...document.nodes];
  for (let visited = 0; visited < pending.length && visited < LIMITS.treeNodesMax; visited++) {
    const node = pending[visited];
    assert(node !== undefined, 'A visited node exists');
    if (node.id !== undefined && document.pathFor(node.id) === edit.root) {
      return edit.breaks === 'line' ? document.format?.contentOwner?.(node.id, 'line') : node.id;
    }
    pending.push(...(node.children ?? []));
  }
  return undefined;
}
