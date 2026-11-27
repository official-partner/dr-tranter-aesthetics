import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import type { IpcResults } from '../../../shared/ipc/ipcResults';
import { withReferencedMessage } from '../../../shared/core/i18n/referencedMessage';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { cleanErrorKeepingReference, type Failure } from '../../lib/cleanError';
import { translateErrorText } from '../../lib/i18n/translateErrorText';
import { windowHeld } from '../../ui/busyLock';
import { pullGitBranch } from './gitChipBridge';
import type { Conflict } from './gitConflictModel';

export type ToastKind = 'error' | 'success' | 'info';
export type ShowToast = (message: string, kind: ToastKind) => void;
type ActionWork = () => Promise<void>;
export type RunAction = (work: ActionWork, successMessage: string | undefined, label?: string) => Promise<boolean>;
export type PendingConflict = Conflict & { readonly deleteAfter: boolean };

export interface GitProject {
  readonly path: string;
  readonly name: string;
}

export interface GitHost {
  readonly info: IpcResults['git:info'] | undefined;
  readonly refresh: () => Promise<unknown>;
  readonly busy: string | undefined;
  readonly project: GitProject;
  readonly showToast: ShowToast;
  readonly flushSave: () => Promise<unknown>;
  readonly onWorktreeChanged?: (() => Promise<unknown>) | undefined;
  readonly onPulled?: (() => void) | undefined;
  readonly pullAccess?: 'allowed' | 'blocked';
}

export interface PullProgress {
  readonly commits: number | undefined;
}

export interface GitSession {
  readonly host: GitHost;
  readonly busy: string | undefined;
  readonly pulling: PullProgress | undefined;
  readonly error: string | undefined;
  readonly setError: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly runAction: RunAction;
  readonly conflict: PendingConflict | undefined;
  readonly setConflict: React.Dispatch<React.SetStateAction<PendingConflict | undefined>>;
  readonly pull: (commits: number | undefined) => void;
}

export function useGitSession(host: GitHost): GitSession {
  const translate = useTranslate();
  const [pulling, setPulling] = useState<PullProgress | undefined>(undefined);
  const [conflict, setConflict] = useState<PendingConflict | undefined>(undefined);
  const settled = useCallback(() => setPulling(undefined), []);
  const action = useActionRunner(host, translate, settled);
  const busy = action.busy ?? host.busy;
  const pull = (commits: number | undefined): void => {
    const info = host.info;
    if (!info?.isRepo || !info.head || info.branch === 'HEAD') {
      return;
    }
    if (host.pullAccess === 'blocked' || windowHeld() || conflict !== undefined) {
      return;
    }
    void action.runAction(
      async () => {
        setPulling({ commits });
        await pullBranch({ host, branch: info.branch, translate }, setConflict);
      },
      undefined,
      translate('git.busy.pulling'),
    );
  };
  return {
    host,
    busy,
    pulling,
    error: action.error,
    setError: action.setError,
    runAction: action.runAction,
    conflict,
    setConflict,
    pull,
  };
}

async function pullBranch(
  { host, branch, translate }: { readonly host: GitHost; readonly branch: string; readonly translate: Translator },
  onConflict: (conflict: PendingConflict) => void,
): Promise<void> {
  const result = await gitValue(pullGitBranch(host.project.path, branch));
  if ('conflicted' in result) {
    onConflict({ ...result, deleteAfter: false });
  } else if ('dirty' in result) {
    host.showToast(translate('git.pull.dirty'), 'error');
  } else {
    host.onPulled?.();
    host.showToast(translate(result.changed ? 'git.pull.done' : 'git.pull.upToDate'), 'success');
  }
}

export async function gitValue<Value>(pending: Promise<{ readonly ok: true; readonly value: Value } | Failure>): Promise<Value> {
  const result = await pending;
  if (!result.ok) {
    throw new Error(withReferencedMessage(result.error, result.errorRef));
  }
  return result.value;
}

function useActionRunner({ flushSave, refresh, onWorktreeChanged, showToast, busy: externalBusy }: GitHost, translate: Translator, settled: () => void) {
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const pending = useRef(false);
  const runAction = useCallback<RunAction>(
    async (work, successMessage, label = translate('git.busy.working')) => {
      if (pending.current || externalBusy) {
        return false;
      }
      pending.current = true;
      setBusy(label);
      setError(undefined);
      try {
        await flushSave();
        await work();
        await refresh();
        await onWorktreeChanged?.();
        if (successMessage) {
          showToast(successMessage, 'success');
        }
        return true;
      } catch (caught: unknown) {
        const message = translateErrorText(cleanErrorKeepingReference(caught), translate);
        setError(message);
        showToast(message, 'error');
        return false;
      } finally {
        pending.current = false;
        setBusy(undefined);
        settled();
      }
    },
    [externalBusy, flushSave, onWorktreeChanged, refresh, settled, showToast, translate],
  );
  return { busy, error, setError, runAction } as const;
}
