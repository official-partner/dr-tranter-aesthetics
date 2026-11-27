import { useEffect, useRef, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import type { RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import type { RemoteDocumentField } from '../../../shared/properties/cmsRemote';
import { RemoteField } from './RemoteField';
import type { RemoteEditContext } from './RemoteValueEditor';

const SAVE_PAUSE_MS = 800;

export function RemoteFieldInput(props: {
  readonly field: RemoteDocumentField;
  readonly context: RemoteEditContext;
  readonly follow?: { readonly value: RemoteValue | undefined } | undefined;
  readonly onDraft?: ((value: RemoteValue | undefined) => void) | undefined;
  readonly requiredShown?: boolean | undefined;
  readonly onSave: (value: RemoteValue | undefined) => void;
}) {
  const { field, follow } = props;
  const save = useDraftSave(field.value, props.onSave);
  const followed = follow === undefined ? '' : valueKey(follow.value);
  useEffect(() => {
    if (follow !== undefined && valueKey(save.draft) !== followed) {
      save.change(follow.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `followed` names the value
  }, [followed]);
  return (
    <div
      className="remote-cms-field-save"
      onFocus={save.focus}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          save.blur();
        }
      }}
    >
      <RemoteField
        field={field}
        value={save.draft}
        context={props.context}
        requiredShown={props.requiredShown}
        onChange={(value) => {
          save.change(value);
          props.onDraft?.(value);
        }}
      />
    </div>
  );
}

function useDraftSave(saved: RemoteValue | undefined, onSave: (value: RemoteValue | undefined) => void) {
  const [draft, setDraft] = useState(saved);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<{ readonly value: RemoteValue | undefined } | undefined>(undefined);
  const focused = useRef(false);
  const latest = useRef(onSave);
  latest.current = onSave;
  const flush = () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = undefined;
    if (next !== undefined) {
      latest.current(next.value);
    }
  };
  useEffect(() => {
    if (pending.current === undefined && !focused.current) {
      setDraft(saved);
    }
  }, [saved]);
  useEffect(() => flush, []);
  const change = (value: RemoteValue | undefined) => {
    setDraft(value);
    pending.current = { value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_PAUSE_MS);
    assert(pending.current !== undefined, 'A change is pending until it is saved');
  };
  return {
    draft,
    change,
    focus: () => {
      focused.current = true;
    },
    blur: () => {
      focused.current = false;
      flush();
    },
  };
}

function valueKey(value: RemoteValue | undefined): string {
  return value === undefined ? '' : JSON.stringify(value);
}
