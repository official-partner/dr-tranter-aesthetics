import { useTranslate } from '../../lib/i18n/useTranslate';
import React from 'react';
import { arrayItems, arrayText, objectFields, objectText } from './arrayValue';
import type { ObjectRow } from './arrayValue';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import ListField from './ListField';
import SegSwitch from './SegSwitch';
import { commitInPlace } from '../../ui/commitInPlace';

interface ObjectFieldProps {
  readonly value?: string | undefined;
  readonly onChange: (value: string, immediate: boolean) => void;
}
export default function ObjectField({ value, onChange }: ObjectFieldProps) {
  assert((value?.length ?? 0) <= LIMITS.attrCharsMax, 'ObjectField: value limit exceeded');
  const fields = objectFields(value) || [];
  const change = (index: number, next: ObjectRow, options: { readonly immediate: boolean }): void => {
    assert(index >= 0, 'ObjectField: field index is nonnegative');
    assert(index < fields.length, 'ObjectField: field index exists');
    const text = objectText(fields.map((field, current) => (current === index ? next : field)));
    assert(text.length <= LIMITS.attrCharsMax, 'ObjectField: output limit exceeded');
    onChange(text, options.immediate);
  };
  return (
    <div className="object-field">
      {fields.map((field, index) => (
        <ObjectRowField key={field.key} field={field} onChange={(next, options) => change(index, next, options)} />
      ))}
    </div>
  );
}
interface RowProps {
  readonly field: ObjectRow;
  readonly onChange: (field: ObjectRow, options: { readonly immediate: boolean }) => void;
}
function ObjectRowField(props: RowProps) {
  return (
    <div className="object-field-row">
      <span className="object-field-key" title={props.field.key}>
        {props.field.key}
      </span>
      <ObjectRowControl {...props} />
    </div>
  );
}
function ObjectRowControl({ field, onChange }: RowProps) {
  const translate = useTranslate();
  if (field.kind === 'list') {
    assert(field.items !== undefined, 'ObjectField: list field has items');
    return (
      <ListField
        value={arrayText(field.items)}
        onChange={(text, immediate) => {
          const items = arrayItems(text, 0, 'bindable');
          assert(items !== undefined, 'ObjectField: list editor produces an array literal');
          onChange({ ...field, items }, { immediate: immediate !== false });
        }}
      />
    );
  }
  assert(field.text !== undefined, 'ObjectField: scalar field has text');
  const text = field.text;
  if (field.kind === 'boolean') {
    return (
      <SegSwitch
        options={[
          { value: true, label: translate('props.newProp.form.true') },
          { value: false, label: translate('props.newProp.form.false') },
        ]}
        current={text === 'true'}
        onPick={(next) => onChange({ ...field, text: next ? 'true' : 'false' }, { immediate: true })}
      />
    );
  }
  return (
    <input
      className="object-field-input"
      value={text}
      spellCheck={false}
      maxLength={LIMITS.attrCharsMax}
      inputMode={field.kind === 'number' ? 'decimal' : undefined}
      onChange={(event) => onChange({ ...field, text: event.target.value }, { immediate: false })}
      onBlur={() => {
        const next: ObjectRow = field.kind === 'number' && !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text.trim()) ? { ...field, kind: 'text', quote: '"' } : field;
        onChange(next, { immediate: true });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commitInPlace(event.currentTarget);
        }
      }}
    />
  );
}
