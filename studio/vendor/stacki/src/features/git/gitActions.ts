import type { WireMergeOutcome } from '../../../shared/ipc/ipcResults';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { cleanErrorKeepingReference } from '../../lib/cleanError';
import { translateErrorText, translateReference } from '../../lib/i18n/translateErrorText';
type Conflict = Extract<WireMergeOutcome, { readonly conflicted: true }> & {
  readonly deleteAfter: boolean;
};
interface ActionOptions {
  readonly projectPath: string;
  readonly branch: string;
  readonly showToast: (message: string, kind: 'error' | 'success' | 'info') => void;
  readonly run: (work: () => Promise<void>, label: string) => void;
  readonly translate?: Translator;
}
interface MergeOptions extends ActionOptions {
  readonly into: string;
  readonly trunk?: string | undefined;
  readonly onConflict?: ((conflict: Conflict) => void) | undefined;
}
interface DeleteOptions extends ActionOptions {
  readonly parked?: boolean;
}
interface TidyOptions extends Pick<ActionOptions, 'projectPath' | 'branch' | 'showToast' | 'translate'> {
  readonly into: string;
  readonly changed?: boolean;
}
interface DirtyOptions extends TidyOptions {
  readonly deleteAfter: boolean;
  readonly onConflict?: ((conflict: Conflict) => void) | undefined;
}


import { confirmDialog } from '../../ui/ConfirmDialog';
import { gitMerge, gitDeleteBranch, gitPark, gitUnpark } from './gitBridge';

export async function mergeBranchAction({
  projectPath,
  branch,
  into,
  trunk,
  run,
  showToast,
  onConflict,
  translate = ENGLISH_TRANSLATE,
}: MergeOptions): Promise<void> {
  const isTrunk = !!trunk && branch === trunk;
  const answer = await confirmDialog({
    title: translate('git.action.merge.title', { branch, into }),
    confirmLabel: translate('git.action.merge.confirm', { into }),
    ...(isTrunk
      ? {}
      : {
          checkbox: {
            label: translate('git.action.merge.deleteAfter', { branch }),
            hint: translate('git.action.merge.deleteHint', { into }),
            defaultChecked: true,
          },
        }),
  });
  if (!answer) {
    return;
  }
  const deleteAfter = !isTrunk && typeof answer === 'object' && answer.checked;
  run(async () => {
    const merged = await gitMerge({ projectPath, branch });
    if ('dirty' in merged) {
      await mergeDirtyWork({ projectPath, branch, into, showToast, onConflict, deleteAfter, translate }, merged.files);
      return;
    }
    if ('conflicted' in merged) {
      onConflict?.({ ...merged, deleteAfter });
      return;
    }
    if (deleteAfter) {
      await tidyUp({ projectPath, branch, into, changed: merged?.changed, showToast, translate });
      return;
    }
    showToast(
      merged?.changed ? translate('git.action.merge.done', { branch, into: merged.into ?? into }) : translate('git.action.merge.alreadyHas', { branch, into }),
      'success',
    );
  }, translate('git.busy.merging'));
}

export async function tidyUp({ projectPath, branch, into, changed, showToast, translate = ENGLISH_TRANSLATE }: TidyOptions): Promise<void> {
  const params = { branch, into } as const;
  try {
    const deleted = await gitDeleteBranch({ projectPath, branch });
    if (!deleted.ok) {
      showToast(translate(changed ? 'git.action.tidy.keptChanged' : 'git.action.tidy.keptUnchanged', params), 'info');
      return;
    }
    showToast(translate(changed ? 'git.action.tidy.deletedChanged' : 'git.action.tidy.deletedUnchanged', params), 'success');
  } catch (error: unknown) {
    const message = translateErrorText(cleanErrorKeepingReference(error), translate);
    showToast(translate(changed ? 'git.action.tidy.failedChanged' : 'git.action.tidy.failedUnchanged', { ...params, message }), 'info');
  }
}

export async function deleteBranchAction({ projectPath, branch, parked, run, showToast, translate = ENGLISH_TRANSLATE }: DeleteOptions): Promise<void> {
  const yes = await confirmDialog({
    title: translate('git.action.delete.title', { branch }),
    body: translate(parked ? 'git.action.delete.bodyParked' : 'git.action.delete.body', { branch }),
    confirmLabel: translate('git.action.delete.confirm'),
    cancelLabel: translate('ui.cancel'),
    danger: true,
  });
  if (yes !== true) {
    return;
  }
  run(async () => {
    const deleted = await gitDeleteBranch({ projectPath, branch });
    if (!deleted.ok) {
      const anyway = await confirmDialog({
        title: translate('git.action.delete.loseTitle'),
        body: translate('git.action.delete.unmerged', { branch }),
        confirmLabel: translate('git.action.delete.anyway'),
        danger: true,
      });
      if (anyway !== true) {
        return;
      }
      await gitDeleteBranch({ projectPath, branch, force: true });
    }
    showToast(translate('git.action.delete.done', { branch }), 'success');
  }, translate('git.busy.deleting'));
}

async function mergeDirtyWork(
  { projectPath, branch, into, showToast, onConflict, deleteAfter, translate = ENGLISH_TRANSLATE }: DirtyOptions,
  files: readonly string[],
): Promise<void> {
  const park = await confirmDialog({
    title: translate('git.action.dirty.title'),
    body: files?.length
      ? translate('git.action.dirty.body', { count: files.length, files: files.slice(0, 3).join(', ') })
      : translate('git.action.dirty.bodyUnknown'),
    confirmLabel: translate('git.action.dirty.confirm'),
  });
  if (!park) {
    return;
  }
  const parked = await gitPark({ projectPath });
  if (!parked?.ok) {
    showToast(parked?.error || translate('git.action.dirty.parkFailed'), 'error');
    return;
  }
  let again: Awaited<ReturnType<typeof gitMerge>>;
  try {
    again = await gitMerge({ projectPath, branch });
  } catch (error: unknown) {
    await gitUnpark({ projectPath });
    throw error;
  }
  const back = await gitUnpark({ projectPath });
  if ('conflicted' in again) {
    onConflict?.({ ...again, deleteAfter });
    return;
  }
  if ('dirty' in again) {
    showToast(translate('git.action.dirty.stillBlocked'), 'error');
    return;
  }
  if (back?.error) {
    showToast(translateReference(back.error, back.errorRef, translate), 'error');
  }
  if (deleteAfter) {
    await tidyUp({ projectPath, branch, into, changed: again?.changed, showToast, translate });
    return;
  }
  showToast(again?.changed ? translate('git.action.merge.doneBack', { branch, into }) : translate('git.action.merge.alreadyHad', { branch, into }), 'success');
  return;
}
