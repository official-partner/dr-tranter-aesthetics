
import { useCallback, useRef } from 'react';
import { STATES } from '../model/resolved';
import { type NativeStyleOptions } from '../model/nativeStyles';
import {
  readNativeStyleByName,
  readNativeStyles,
  removeNativePropertyAt,
  resolveIdentityElement,
  liveSetNativeProperty,
  type NativeWriteTarget,
} from '../model/webflow';
import { standaloneNativeClass } from './EditorBasics';
import { nativeModelCache } from './editorModel';
import { useEditorRefs, useBusyState, useScanState, useNativeState } from './useEditorFoundation';

export function useNativeRefresh(editorRefs: ReturnType<typeof useEditorRefs>, nativeState: ReturnType<typeof useNativeState>) {
  const { selectedRef } = editorRefs;
  const { activeSelectorRef, nativeIdentityRef, nativeModelRef, setNativeModel } = nativeState;

  const refreshNative = useCallback(async () => {
    const selectedElement = selectedRef.current;
    if (!selectedElement) {
      const className = standaloneNativeClass(activeSelectorRef.current);
      if (!className) {
        return;
      }
      const next = await readNativeStyleByName(className, STATES);
      nativeModelRef.current = next;
      nativeIdentityRef.current = `standalone:${className}`;
      setNativeModel(next);
      return;
    }
    nativeModelCache.clear();
    const identity = await resolveIdentityElement(selectedElement);
    const model = await readNativeStyles(identity, STATES);
    nativeModelRef.current = model;
    setNativeModel(model);
  }, [activeSelectorRef, nativeIdentityRef, nativeModelRef, selectedRef, setNativeModel]);
  return { refreshNative };
}

export function useNativeOps(
  editorRefs: ReturnType<typeof useEditorRefs>,
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  nativeState: ReturnType<typeof useNativeState>,
  nativeRefresh: ReturnType<typeof useNativeRefresh>,
) {
  const { selectedRef } = editorRefs;
  const { setBusyBoth } = busyState;
  const { setStatus } = scanState;
  const { nativeModelRef } = nativeState;
  const { refreshNative } = nativeRefresh;

  const nativeOpChain = useRef<Promise<unknown>>(Promise.resolve());
  const runNativeOp = useCallback(<T>(op: () => Promise<T>): Promise<T> => {
    const next = nativeOpChain.current.then(op, op);
    nativeOpChain.current = next.catch(() => {});
    return next;
  }, []);
  const nativeWriteTargetAt = useCallback(
    (index: number): NativeWriteTarget => {
      const style = nativeModelRef.current?.styles[index];
      return { namePath: style?.namePath ?? [], index: style && style.applied ? index : undefined };
    },
    [nativeModelRef],
  );
  const nativeClearAt = useCallback(
    (index: number, props: string[], options?: NativeStyleOptions) =>
      runNativeOp(async () => {
        let ok = true;
        try {
          setBusyBoth(true);
          setStatus('Saving…');
          const result = await removeNativePropertyAt(selectedRef.current, nativeWriteTargetAt(index), props, options);
          ok = result.ok;
        } finally {
          setBusyBoth(false);
        }
        await refreshNative();
        setStatus(ok ? 'Removed from the Webflow class style.' : 'Couldn’t remove from the Webflow class style.');
      }),
    [refreshNative, setBusyBoth, nativeWriteTargetAt, runNativeOp, selectedRef, setStatus],
  );
  const nativeLiveSet = useCallback(
    (handle: unknown, prop: string, value: string, options?: NativeStyleOptions) => {
      void runNativeOp(async () => {
        await liveSetNativeProperty(handle, prop, value, options);
      });
    },
    [runNativeOp],
  );
  return { nativeClearAt, nativeLiveSet, nativeWriteTargetAt, runNativeOp };
}
