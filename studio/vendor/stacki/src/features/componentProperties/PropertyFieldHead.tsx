
import { useRef, useState, type ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { CodeBlock } from '../../ui/CodeBlock';
import { BracesIcon } from '../../ui/Icons';
import { ResetLabel } from '../../ui/ResetLabel';
import { BindHandle, FieldDataPicker, dataPickerPosition } from '../props/propBindings';

type PickerPosition = ReturnType<typeof dataPickerPosition>;

export function PropertyFieldHead(props: {
  readonly title: string;
  readonly onReset: (() => void) | undefined;
  readonly resetRefusal?: string | undefined;
  readonly onConditional: (() => void) | undefined;
  readonly children?: ReactNode;
}) {
  const [pickerAt, setPickerAt] = useState<PickerPosition | undefined>(undefined);
  const headRef = useRef<HTMLDivElement>(null);
  const { onConditional, onReset } = props;
  assert(props.title !== '', 'PropertyFieldHead: the setting has a title');
  return (
    <div className="property-default-title property-field-head" ref={headRef}>
      <ResetLabel
        label={props.title}
        active={onReset !== undefined || props.resetRefusal !== undefined}
        resetDisabledReason={props.resetRefusal}
        onReset={() => onReset?.()}
      />
      {props.children}
      {onConditional !== undefined && (
        <BindHandle
          active={pickerAt !== undefined}
          onOpen={() => {
            if (pickerAt !== undefined) {
              setPickerAt(undefined);
              return;
            }
            const field = headRef.current?.parentElement ?? undefined;
            if (field !== undefined) {
              setPickerAt(dataPickerPosition(field.getBoundingClientRect()));
            }
          }}
        />
      )}
      {pickerAt !== undefined && onConditional !== undefined && (
        <FieldDataPicker
          pos={pickerAt}
          rows="lead"
          onPick={() => setPickerAt(undefined)}
          onConditional={() => {
            setPickerAt(undefined);
            onConditional();
          }}
          onClose={() => setPickerAt(undefined)}
        />
      )}
    </div>
  );
}

export function PropertyCodeToggle(props: { readonly open: boolean; readonly onToggle: () => void }) {
  const translate = useTranslate();
  const label = translate('componentProps.settings.viewCode');
  return (
    <button
      type="button"
      className={`prop-expr-toggle${props.open ? ' on' : ''}`}
      title={props.open ? translate('componentProps.settings.useControls') : label}
      aria-label={label}
      aria-pressed={props.open}
      onClick={props.onToggle}
    >
      <BracesIcon size={12} />
    </button>
  );
}

export function PropertyCodeView({ code }: { readonly code: string }) {
  const translate = useTranslate();
  assert(code.trim() !== '', 'PropertyCodeView: a setting always writes some code');
  return (
    <div className="property-readonly-code">
      <CodeBlock text={code} language="typescript" label={translate('componentProps.settings.viewCode')} />
    </div>
  );
}
