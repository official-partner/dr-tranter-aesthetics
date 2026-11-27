
import React, { useState } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import DataChip from '../../ui/DataChip';
import ExprInput from '../../ui/ExprInput';
import { BracesIcon } from '../../ui/Icons';
import { scopeCompletions } from '../../editor/dataSuggest';
import { pureBindingPath } from '../../editor/bindingPath';
import { dataPickerPosition } from './dataPickerPosition';
import { FieldDataPicker, type FieldPosition } from './propBindings';
import type { RichContext } from './RichContent';
import { CAPTION_LABEL_FOR } from '../../ui/captionLabel';

export interface ExprBindingFieldProps {
  readonly nodeId: string;
  readonly value: string;
  readonly bindContext: RichContext | undefined;
  readonly onSetText: (value: string) => void;
}

export default function ExprBindingField({ nodeId, value, bindContext, onSetText }: ExprBindingFieldProps) {
  const translate = useTranslate();
  const [raw, setRaw] = useState(false);
  const [picker, setPicker] = useState<FieldPosition | undefined>(undefined);
  const path = pureBindingPath(value);
  const showChip = !raw && path !== undefined;
  return (
    <div className="props-field" style={{ marginTop: 8 }}>
      <label htmlFor={CAPTION_LABEL_FOR} onClick={(event) => event.preventDefault()}>
        <span className="prop-label">{translate('props.sources.binding')}</span>
        <button
          type="button"
          className={`prop-expr-toggle${raw ? ' on' : ''}`}
          aria-pressed={raw}
          aria-label={translate('props.field.writeExpression')}
          aria-disabled={raw && path === undefined}
          onClick={() => {
            if (raw && path === undefined) {
              return;
            }
            setPicker(undefined);
            setRaw(!raw);
          }}
        >
          <BracesIcon size={12} />
        </button>
      </label>
      {showChip ? (
        <div className="bind-input text-connection" role="group" aria-label={translate('props.sources.binding')}>
          <DataChip
            path={path}
            onPick={(chip) => {
              const at = dataPickerPosition(chip.getBoundingClientRect());
              setPicker(picker === undefined ? at : undefined);
            }}
          />
        </div>
      ) : (
        <ExprInput
          key={nodeId}
          value={value}
          syncValue={value}
          completions={scopeCompletions(bindContext ?? {})}
          onCommit={(next) => next !== value && onSetText(next)}
        />
      )}
      {picker !== undefined && (
        <FieldDataPicker
          pos={picker}
          bindContext={bindContext}
          current={path}
          onBindNew={(picked) => {
            setPicker(undefined);
            onSetText(`{${picked}}`);
          }}
          onPick={(picked) => {
            setPicker(undefined);
            onSetText(`{${picked}}`);
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
    </div>
  );
}
