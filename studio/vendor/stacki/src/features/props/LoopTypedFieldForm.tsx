
import { useState } from 'react';
import { reportErrorToast } from '../../ui/errorNotices';
import Dropdown from '../../ui/Dropdown';
import CodeTextField from './CodeTextField';
import { LOOP_QUERY_LIMITS } from '../../editor/loopQuery';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { CatalogField } from './loopCatalog';
import { TYPED_KINDS, typedField, typedPathOf, type TypedKind } from './loopTypedField';

export interface TypedFieldSupport {
  readonly item: string | undefined;
}

export function TypedFieldForm(props: { readonly item: string | undefined; readonly onUse: (field: CatalogField) => void }) {
  const translate = useTranslate();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<TypedKind>('text');
  const [invalid, setInvalid] = useState(false);
  const use = (): void => {
    const path = typedPathOf(text, props.item);
    if (path.ok) {
      setInvalid(false);
      props.onUse(typedField(path.path, kind));
    } else {
      setInvalid(true);
      reportErrorToast(translate('props.loop.typed.invalid'));
    }
  };
  const labels: Readonly<Record<TypedKind, string>> = {
    text: translate('props.loop.typed.text'),
    number: translate('props.loop.typed.number'),
    date: translate('props.loop.typed.date'),
    boolean: translate('props.loop.typed.boolean'),
  };
  return (
    <div className="loop-typed-form">
      <span className="loop-typed-label">{translate('props.loop.typed.path')}</span>
      {}
      <div
        className="loop-typed-input"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            use();
          }
        }}
      >
        <CodeTextField
          value={text}
          language="javascript"
          ariaLabel={translate('props.loop.typed.path')}
          placeholder={translate('props.loop.typed.placeholder')}
          invalid={invalid}
          onChange={(next) => {
            setInvalid(false);
            setText(next.slice(0, LOOP_QUERY_LIMITS.fieldPathCharsMax));
          }}
        />
      </div>
      <span className="loop-typed-label">{translate('props.loop.typed.type')}</span>
      <Dropdown<TypedKind>
        livePreview={false}
        value={kind}
        ariaLabel={translate('props.loop.typed.type')}
        options={TYPED_KINDS.map((option) => ({ value: option, label: labels[option] }))}
        onChange={setKind}
      />
      <div className="loop-typed-actions">
        <button type="button" className="primary" onClick={use}>
          {translate('props.loop.typed.use')}
        </button>
      </div>
    </div>
  );
}
