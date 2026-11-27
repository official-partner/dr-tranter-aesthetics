import { list, record } from '../core/boundary';
import { parseSiteFolderChoice, type SiteFolderChoice } from './astroCopy';

export const FOLDER_OPEN_LIMITS = {
  queueMax: 16,
  argumentsMax: 64,
  dropItemsMax: 64,
} as const satisfies Record<string, number>;

export const FOLDER_REJECTIONS = ['missing', 'notFolder', 'unreadable'] as const;
export type FolderRejection = (typeof FOLDER_REJECTIONS)[number];

export type FolderOpenChoice = Exclude<SiteFolderChoice, { readonly kind: 'canceled' }> | { readonly kind: 'rejected'; readonly reason: FolderRejection };

export function parseFolderRejection(input: unknown): FolderRejection {
  const reason = FOLDER_REJECTIONS.find((known) => known === input);
  if (reason === undefined) {
    throw new Error('FolderRejection: unknown value');
  }
  return reason;
}

export function parseFolderOpenChoice(input: unknown): FolderOpenChoice {
  const fields = record(input);
  if (fields['kind'] === 'rejected') {
    return { kind: 'rejected', reason: parseFolderRejection(fields['reason']) };
  }
  const choice = parseSiteFolderChoice(input);
  if (choice.kind === 'canceled') {
    throw new Error('FolderOpenChoice.kind: a folder that arrived is never canceled');
  }
  return choice;
}

export function parseFolderOpenChoices(input: unknown): readonly FolderOpenChoice[] {
  const choices = list(parseFolderOpenChoice)(input);
  if (choices.length > FOLDER_OPEN_LIMITS.queueMax) {
    throw new Error('FolderOpenChoices: exceeds limit');
  }
  return choices;
}
