
import { useState } from 'react';
import type { Attr } from '../../../shared/page/pageNode';
import type { Item } from './arrayValue';
import type { SourceContext } from './bindingTypes';
import { itemFieldOf, itemFieldValue } from './listItemShape';
import { itemRowDeclaration, itemRowField, type DeclaredItemType } from './listItemType';
import type { PropItemKind } from '../../../shared/properties/propSchema';
import PropField from './PropField';
import { PropPreviewContext } from './propPreviewContext';
import type { RichContext } from './RichContent';
import './listScalar.css';

export interface ListScalarItemProps {
  readonly item: Item;
  readonly kind: PropItemKind;
  readonly declared: DeclaredItemType | undefined;
  readonly quote: string;
  readonly bindContext: RichContext | undefined;
  readonly dataContext: SourceContext | undefined;
  readonly onChange: (item: Item) => void;
}

const NUMBER_UNDER_WAY = /^[-+]?\.?$/;
const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)$/;

export default function ListScalarItem(props: ListScalarItemProps) {
  const { item, kind, declared, quote } = props;
  const [draft, setDraft] = useState<Attr | undefined>(undefined);
  const name = 'value';
  const declaration = itemRowDeclaration(kind, name, declared);
  const field = { key: name, keyQuote: undefined, text: String(item.text ?? ''), quote: item.quote };
  const write = (value: Attr | undefined): void => {
    if (value === undefined && kind === 'number') {
      setDraft({ type: 'string', value: '' });
      return;
    }
    const next = itemFieldOf(field, value, declaration, quote);
    if (next === undefined) {
      setDraft(heldNumber(value, kind));
      return;
    }
    setDraft(undefined);
    props.onChange({ text: next.text, quote: next.quote });
  };
  const shown = draft ?? itemFieldValue(field);
  const invalid = kind === 'number' && draft !== undefined && !NUMBER_TEXT.test(draft.type === 'bare' ? '' : draft.value.trim());
  return (
    <div className={`list-scalar-item${invalid ? ' is-invalid' : ''}`}>
      {}
      <PropPreviewContext.Provider value={undefined}>
        <PropField
          nodeKey="item:value"
          field={itemRowField(kind, name, declared)}
          value={shown}
          bindContext={props.bindContext}
          dataContext={props.dataContext}
          onChange={write}
        />
      </PropPreviewContext.Provider>
    </div>
  );
}

function heldNumber(value: Attr | undefined, kind: PropItemKind): Attr | undefined {
  if (value?.type === 'expr' && kind === 'number' && NUMBER_UNDER_WAY.test(value.value.trim())) {
    return { type: 'string', value: value.value };
  }
  return value;
}
