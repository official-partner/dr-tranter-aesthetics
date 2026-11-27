
import { useTranslate } from '../../lib/i18n/useTranslate';
import React, { useState } from 'react';
import AutoTextarea from '../../ui/AutoTextarea';
import { ResetMenu } from '../../ui/ResetLabel';
import { VariableTextSizeIcon } from '../../ui/Icons';
import { assert } from '../../../shared/core/assert';
import { dataPickerPosition } from './dataPickerPosition';
import { BindHandle, FieldDataPicker, type FieldPickerAt, type FieldPosition } from './propBindings';
import type { RichContext } from './RichContent';
import { FIELD_UNFOCUSED } from './fieldFocus';
import { propNamed } from '../../editor/loopProps';
import { connectedPath, connectedPieces, disconnectedText, type TextPiece } from './textConnect';
import { CAPTION_LABEL_FOR } from '../../ui/captionLabel';

export interface TextConnectFieldProps {
  readonly node: { readonly kind: 'text' | 'expr'; readonly id: string; readonly value: string };
  readonly bindContext: RichContext | undefined;
  readonly onSetText: (value: string) => void;
  readonly onSetTextPieces: ((pieces: readonly TextPiece[]) => void) | undefined;
}

export function isTextConnection(expression: string, context: RichContext | undefined): boolean {
  const path = connectedPath(expression);
  if (path === undefined || context?.newProp === undefined) {
    return false;
  }
  return propNamed(context.frontmatter ?? '', path) !== undefined;
}

export default function TextConnectField(props: TextConnectFieldProps) {
  const translate = useTranslate();
  const { node, bindContext, onSetText, onSetTextPieces } = props;
  const [picker, setPicker] = useState<FieldPickerAt | undefined>(undefined);
  const [menu, setMenu] = useState<FieldPosition | undefined>(undefined);
  const path = node.kind === 'expr' ? connectedPath(node.value) : undefined;
  assert(node.kind === 'text' || path !== undefined, 'TextConnectField: an expression it shows is a connection');
  const words = node.kind === 'text' ? node.value : '';
  const disconnect = () => {
    setMenu(undefined);
    if (path !== undefined && onSetTextPieces !== undefined) {
      onSetTextPieces([{ kind: 'text', value: disconnectedText(path, bindContext?.frontmatter ?? '') }]);
    }
  };
  const place = (picked: string) => {
    const focus = picker?.focus ?? FIELD_UNFOCUSED;
    setPicker(undefined);
    onSetTextPieces?.(connectedPieces(words, node.kind === 'text' ? focus : FIELD_UNFOCUSED, picked));
  };
  return (
    <div className="props-field" style={{ marginTop: 8 }}>
      <label htmlFor={CAPTION_LABEL_FOR} onClick={(event) => event.preventDefault()}>
        <span
          className={`prop-label${path === undefined ? '' : ' set'}`}
          title={path === undefined ? undefined : translate('props.textConnect.disconnectHint')}
          onClick={(event) => {
            event.preventDefault();
            if (path === undefined) {
              return;
            }
            if (event.altKey) {
              disconnect();
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu({ left: bounds.left, top: bounds.bottom + 4 });
          }}
        >
          <VariableTextSizeIcon size={12} className="prop-label-icon" />
          {translate('props.element.content')}
        </span>
        {onSetTextPieces !== undefined && (
          <BindHandle
            active={picker !== undefined}
            onOpen={(host, focus) => {
              if (picker !== undefined) {
                setPicker(undefined);
                return;
              }
              const bounds = host?.getBoundingClientRect();
              if (bounds !== undefined) {
                setPicker({ ...dataPickerPosition(bounds), focus });
              }
            }}
          />
        )}
      </label>
      {path === undefined ? (
        <AutoTextarea key={node.id} minRows={3} value={words} onChange={(event) => onSetText(event.target.value)} />
      ) : (
        <div className="bind-input text-connection" role="textbox" aria-readonly="true" aria-label={translate('props.element.content')}>
          <span className="expr-chip" data-expr={path}>
            {path}
          </span>
        </div>
      )}
      {picker && (
        <FieldDataPicker
          pos={picker}
          bindContext={bindContext}
          current={path}
          seed={{ fit: 'content', label: 'Text', value: words.trim() }}
          onBindNew={place}
          onPick={place}
          onClose={() => setPicker(undefined)}
        />
      )}
      {menu && (
        <ResetMenu
          position={menu}
          resetLabel={translate('props.attributesBinding.disconnect')}
          onReset={disconnect}
          unbindLabel=""
          onClose={() => setMenu(undefined)}
        />
      )}
    </div>
  );
}
