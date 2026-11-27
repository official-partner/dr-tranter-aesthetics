import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSharedVars } from './VariableConnect';
import { type SetProp, type ClearProp, type LiveSetProp, type Read, type SelectSelector, type Side } from './spacingTypes';
import { SpacingLabel } from './SpacingLabel';
import { SpacingEditor } from './SpacingEditor';
export { SpacingEditor } from './SpacingEditor';

export { SpacingLabel } from './SpacingLabel';

export { FRAMES, type FrameKey, SpacingFill } from './SpacingFill';

export { type SetProp, type ClearProp, type LiveSetProp, type Read, type SelectSelector, type Side } from './spacingTypes';


type SharedProps = {
  read: Read;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
  onSelectSelector: SelectSelector;
};

export function useSpacingBox(
  shared: SharedProps,
  options?: { emptyLabel?: string; variableLabels?: boolean },
): {
  label: (prop: string, side: Side) => ReactNode;
  fillHandlers: { onLive: (props: string[], display: string) => void; onLiveEnd: () => void };
  editor: ReactNode;
} {
  const emptyLabel = options?.emptyLabel ?? '0';
  const { vars: variables } = useSharedVars({ active: !!options?.variableLabels });
  const [liveDrag, setLiveDrag] = useState<{ props: string[]; value: string } | undefined>(undefined);
  const onLive = (dragProps: string[], value: string) => setLiveDrag({ props: dragProps, value });
  const onLiveEnd = () => setLiveDrag(undefined);

  const [editing, setEditing] = useState<{ prop: string; side: Side; opening: number } | undefined>(undefined);
  const openingRef = useRef(0);
  const commitOpenRef = useRef<(() => void) | undefined>(undefined);
  const registerCommit = useCallback((commit: (() => void) | undefined) => {
    commitOpenRef.current = commit;
  }, []);
  const suppressReopen = useRef<string | undefined>(undefined);
  const onEdit = (prop: string, side: Side) => {
    if (suppressReopen.current === prop) {
      suppressReopen.current = undefined;
      return;
    }
    suppressReopen.current = undefined;
    commitOpenRef.current?.();
    openingRef.current += 1;
    setEditing({ prop, side, opening: openingRef.current });
  };

  const label = (prop: string, side: Side) => (
    <SpacingLabel
      key={prop}
      prop={prop}
      side={side}
      override={liveDrag?.props.includes(prop) ? liveDrag.value : undefined}
      emptyLabel={emptyLabel}
      read={shared.read}
      busy={shared.busy}
      clearProp={shared.clearProp}
      onEdit={onEdit}
      variables={variables}
      {...(options?.variableLabels === undefined ? {} : { variableLabels: options.variableLabels })}
      setProp={shared.setProp}
      liveSetProp={shared.liveSetProp}
      onLive={onLive}
      onLiveEnd={onLiveEnd}
    />
  );

  const editor = editing ? (
    <SpacingEditor
      key={`${editing.prop}:${editing.opening}`}
      prop={editing.prop}
      side={editing.side}
      placeholder={emptyLabel}
      read={shared.read}
      setProp={shared.setProp}
      clearProp={shared.clearProp}
      liveSetProp={shared.liveSetProp}
      onSelectSelector={shared.onSelectSelector}
      onClose={() => setEditing(undefined)}
      onSameLabelPress={() => {
        suppressReopen.current = editing.prop;
      }}
      registerCommit={registerCommit}
    />
  ) : undefined;

  return { label, fillHandlers: { onLive, onLiveEnd }, editor };
}
