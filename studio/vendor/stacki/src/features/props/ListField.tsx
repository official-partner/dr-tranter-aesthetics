import { useTranslate } from '../../lib/i18n/useTranslate';
import PropTip from './PropTip';
import { reportActionToast } from '../../ui/errorNotices';
import { itemFieldTitle } from '../../editor/itemFields';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Attr } from '../../../shared/page/pageNode';
import type { Item, ItemField } from './arrayValue';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { PlusIcon, CloseIcon, ChevronDownIcon, ChevronRightIcon } from '../../ui/Icons';
import ListFieldRow from '../../ui/ListFieldRow';
import type { PickedAsset } from '../../ui/AssetField';
import { allowDragEffect } from '../../editor/dragState';
import { arrayItems, arrayText, blankLike, itemLabel, moveItem, nestedItems } from './arrayValue';
import type { SourceContext } from './bindingTypes';
import ListScalarItem from './ListScalarItem';
import { defaultItemOf, kindOfItem, listItemKindOf, type DeclaredItemType, type ListItemKind } from './listItemType';
import { blankItemOf, conformedItem, itemFieldDeclaration, itemFieldDefinition, itemFieldOf, itemFieldValue, type ItemShapeField } from './listItemShape';
import PropField from './PropField';
import type { RichContext } from './RichContent';


interface Position {
  readonly top: number;
  readonly left: number;
  readonly width: number;
}
interface ItemEditorProps {
  readonly item: Item;
  readonly shape: readonly ItemShapeField[] | undefined;
  readonly projectPath: string | undefined;
  readonly bindContext: RichContext | undefined;
  readonly dataContext: SourceContext | undefined;
  readonly kind: ListItemKind;
  readonly itemType: DeclaredItemType | undefined;
  readonly quote: string;
  readonly position: Position;
  readonly trigger: HTMLElement;
  readonly onChange: (item: Item) => void;
  readonly onClose: () => void;
}
function ItemEditor({
  item: given,
  shape,
  projectPath,
  bindContext,
  dataContext,
  kind,
  itemType,
  quote,
  position,
  trigger,
  onChange,
  onClose,
}: ItemEditorProps) {
  const translate = useTranslate();
  const ref = useListEditorDismiss(trigger, onClose);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLInputElement>('input:not([type="color"]), .bind-input, .cm-content');
    first?.focus();
    if (first?.tagName === 'INPUT') {
      first.select();
    }
  }, [ref]);

  const item = conformedItem(given, shape, '"');
  const fields = item.fields;
  const scalarKind = kind === 'text' || kind === 'number' || kind === 'switch' || kind === 'choice' ? kind : kindOfItem(item);
  return (
    <div
      ref={ref}
      className="attr-editor list-item-editor"
      style={{ top: position.top, left: position.left, width: position.width }}
      onKeyDown={(event) => closeOnEnter(event, onClose)}
    >
      <div className="var-src-head">
        <span className="var-src-name">{translate('props.list.item')}</span>
        <span style={{ flex: 1 }} />
        <button className="ghost" title={translate('ui.close')} onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
      {fields === undefined ? (
        <ListScalarItem
          item={item}
          kind={scalarKind}
          declared={itemType}
          quote={quote}
          bindContext={bindContext}
          dataContext={dataContext}
          onChange={onChange}
        />
      ) : (
        fields.map((field, at) => (
          <ItemFieldControl
            key={field.key}
            field={field}
            declaration={itemFieldDeclaration(field, shape)}
            projectPath={projectPath}
            bindContext={bindContext}
            dataContext={dataContext}
            onSet={(next) => onChange({ fields: fields.map((own, index) => (index === at ? next : own)) })}
          />
        ))
      )}
    </div>
  );
}

function closeOnEnter(event: React.KeyboardEvent<HTMLDivElement>, onClose: () => void): void {
  const ElementType = event.currentTarget.ownerDocument.defaultView?.Element;
  if (event.key !== 'Enter' || ElementType === undefined || !(event.target instanceof ElementType)) {
    return;
  }
  if (event.target.closest('.bind-menu, .cm-editor') === null) {
    event.preventDefault();
    onClose();
  }
}

function ItemFieldControl(props: {
  readonly field: ItemField;
  readonly declaration: ItemShapeField;
  readonly projectPath: string | undefined;
  readonly bindContext: RichContext | undefined;
  readonly dataContext: SourceContext | undefined;
  readonly onSet: (field: ItemField) => void;
}) {
  const { field, declaration, projectPath, onSet } = props;
  const [draft, setDraft] = useState<Attr | undefined>(undefined);
  if (declaration.kind === 'list' || declaration.kind === 'group') {
    return (
      <NestedFieldEditor
        field={field}
        declaration={declaration}
        projectPath={projectPath}
        bindContext={props.bindContext}
        dataContext={props.dataContext}
        onSet={onSet}
      />
    );
  }
  const write = (value: Attr | undefined): void => {
    const next = itemFieldOf(field, value, declaration, '"');
    setDraft(next === undefined ? heldDraft(value, declaration.kind) : undefined);
    if (next !== undefined) {
      onSet(next);
    }
  };
  const pickAsset = (_name: string, picked: PickedAsset): void => {
    if (picked.root === 'public') {
      write({ type: 'string', value: `/${picked.rel.split('/').slice(1).join('/')}` });
    } else {
      reportActionToast('A list item’s image is a URL: choose one from public/, or enter its address.', 'warning', []);
    }
  };
  return (
    <>
      <PropField
        nodeKey={`item:${field.key}`}
        field={itemFieldDefinition(field.key, declaration)}
        value={draft ?? itemFieldValue(field)}
        bindContext={props.bindContext}
        dataContext={props.dataContext}
        assetContext={projectPath === undefined ? undefined : { projectPath, onPickAsset: pickAsset }}
        onChange={write}
      />
    </>
  );
}

function NestedFieldEditor(props: {
  readonly field: ItemField;
  readonly declaration: Extract<ItemShapeField, { kind: 'list' | 'group' }>;
  readonly projectPath: string | undefined;
  readonly bindContext: RichContext | undefined;
  readonly dataContext: SourceContext | undefined;
  readonly onSet: (field: ItemField) => void;
}) {
  const translate = useTranslate();
  const { field, declaration, onSet } = props;
  const [open, setOpen] = useState(false);
  const nested = field.quote === undefined ? nestedItems(field.text) : undefined;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  const summary = declaration.kind === 'list' ? countLabel(nested?.length ?? 0, translate) : '';
  return (
    <div className="props-field list-item-nested" data-kind={declaration.kind}>
      <button
        type="button"
        className="list-item-nested-head"
        aria-expanded={open}
        aria-label={translate('props.list.nestedLabel', { key: field.key, kind: itemFieldTitle(declaration.kind, translate) })}
        onClick={() => setOpen(!open)}
      >
        <Chevron size={12} />
        <span className="list-item-nested-name">{field.key}</span>
        {}
        {nested === undefined && <PropTip text={translate(declaration.kind === 'list' ? 'props.list.listInCode' : 'props.list.groupInCode')} />}
        {summary !== '' && <span className="list-item-nested-count">{summary}</span>}
      </button>
      {open && nested !== undefined && declaration.kind === 'list' && (
        <ListField
          value={field.text}
          itemShape={declaration.fields}
          projectPath={props.projectPath}
          bindContext={props.bindContext}
          dataContext={props.dataContext}
          itemsMax={LIST_ITEMS_MAX}
          onChange={(text) => onSet({ ...field, text })}
        />
      )}
      {open && nested !== undefined && declaration.kind === 'group' && (
        <GroupFields
          fields={nested[0]?.fields ?? []}
          shape={declaration.fields}
          projectPath={props.projectPath}
          bindContext={props.bindContext}
          dataContext={props.dataContext}
          onChange={(fields) => onSet({ ...field, text: arrayText([{ fields }]).slice(1, -1) })}
        />
      )}
    </div>
  );
}

function GroupFields(props: {
  readonly fields: readonly ItemField[];
  readonly shape: readonly ItemShapeField[];
  readonly projectPath: string | undefined;
  readonly bindContext: RichContext | undefined;
  readonly dataContext: SourceContext | undefined;
  readonly onChange: (fields: readonly ItemField[]) => void;
}) {
  const fields = conformedItem({ fields: props.fields }, props.shape, '"').fields ?? [];
  return (
    <div className="list-item-nested-body">
      {fields.map((field, at) => (
        <ItemFieldControl
          key={field.key}
          field={field}
          declaration={itemFieldDeclaration(field, props.shape)}
          projectPath={props.projectPath}
          bindContext={props.bindContext}
          dataContext={props.dataContext}
          onSet={(next) => props.onChange(fields.map((own, index) => (index === at ? next : own)))}
        />
      ))}
    </div>
  );
}

function countLabel(count: number, translate: Translator): string {
  return count === 0 ? translate('props.list.noItems') : translate('props.list.itemCount', { count });
}

function heldDraft(value: Attr | undefined, kind: ItemShapeField['kind']): Attr | undefined {
  if (value?.type === 'expr' && kind === 'number' && /^[-+]?\.?$/.test(value.value.trim())) {
    return { type: 'string', value: value.value };
  }
  return value;
}

function useListEditorDismiss(trigger: HTMLElement, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (event.composedPath().includes(trigger)) {
        return;
      }
      const NodeType = ref.current?.ownerDocument.defaultView?.Node;
      if (NodeType && event.target instanceof NodeType && !ref.current?.contains(event.target)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !ref.current?.querySelector('.bind-menu')) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, trigger]);
  return ref;
}

export function emptyNote(placeholder: unknown) {
  const text = String(placeholder ?? '').trim();
  return !text || /^\[\s*\]$/.test(text) ? '' : text;
}

const LIST_ITEMS_MAX = 100;

export type ListFieldChange =
  | { readonly kind: 'edit'; readonly index: number }
  | { readonly kind: 'add' }
  | { readonly kind: 'remove'; readonly index: number }
  | { readonly kind: 'move'; readonly index: number; readonly gap: number };

interface ListFieldProps {
  readonly value?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly onChange: (value: string, immediate: boolean, change: ListFieldChange) => void;
  readonly disabled?: boolean;
  readonly itemsMin?: number;
  readonly itemsMax?: number;
  readonly valueCharsMax?: number;
  readonly itemShape?: readonly ItemShapeField[] | undefined;
  readonly itemType?: DeclaredItemType | undefined;
  readonly fallback?: string | undefined;
  readonly projectPath?: string | undefined;
  readonly bindContext?: RichContext | undefined;
  readonly dataContext?: SourceContext | undefined;
}
type Editor =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'existing';
      readonly index: number;
      readonly position: Position;
      readonly trigger: HTMLElement;
    }
  | {
      readonly kind: 'pending';
      readonly item: Item;
      readonly position: Position;
      readonly trigger: HTMLElement;
    };
type Drag =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'dragging';
      readonly index: number;
      readonly gap: number | undefined;
    };

export default function ListField(props: ListFieldProps) {
  const translate = useTranslate();
  const state = useListField(props);
  const note = state.fallback ? '' : emptyNote(props.placeholder);
  const { itemsRef, scrolls } = useItemsScroll(state.items.length);
  return (
    <div className={`list-field ${state.fallback ? 'is-fallback' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={state.drop}>
      {state.items.length === 0 && note ? <div className="list-field-empty">{note}</div> : undefined}
      {state.items.length > 0 && (
        <div ref={itemsRef} className={`list-field-items${scrolls ? ' is-scrolling' : ''}`} onScroll={() => closeListRowEditor(state)}>
          {state.items.map((item, index) => (
            <ListRow key={index} item={item} index={index} state={state} />
          ))}
        </div>
      )}
      <button
        type="button"
        className="list-field-add"
        disabled={state.disabled || state.items.length >= state.itemsMax}
        onClick={(event) => {
          if (state.editor.kind === 'pending') {
            state.closePending();
          } else {
            state.openAt(event, undefined, state.blank());
          }
        }}
      >
        <PlusIcon size={12} />
        {translate('props.list.addItem')}
      </button>
      <ListEditor state={state} />
    </div>
  );
}

function useItemsScroll(count: number) {
  const itemsRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const element = itemsRef.current;
    if (element === null) {
      setScrolls(false);
      return undefined;
    }
    const measure = (): void => setScrolls(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  return { itemsRef, scrolls };
}

function useListField(props: ListFieldProps) {
  const { value, onChange, disabled = false, itemsMin = 0, itemsMax = LIMITS.scanEntriesMax, valueCharsMax = LIMITS.attrCharsMax, itemShape } = props;
  assert((value?.length ?? 0) <= valueCharsMax, 'ListField: value limit exceeded');
  const own = arrayItems(value, 0, 'bindable');
  const fallbackItems = own === undefined && (value ?? '').trim() === '' ? arrayItems(props.fallback, 0, 'bindable') : undefined;
  const fallback = fallbackItems !== undefined && fallbackItems.length > 0;
  const items = own || fallbackItems || [];
  assert(items.length <= itemsMax, 'ListField: item count limit exceeded');
  const [editor, setEditor] = useState<Editor>({ kind: 'closed' });
  const write = (next: readonly Item[], options: { readonly immediate: boolean; readonly change: ListFieldChange }) => {
    if (disabled) {
      return;
    }
    if (fallback && next.length === items.length && next.every((item, index) => item === items[index])) {
      return;
    }
    const text = arrayText(next);
    assert(text.length <= valueCharsMax, 'ListField: output limit exceeded');
    assert(next.length <= itemsMax, 'ListField: output item count limit exceeded');
    onChange(text, options.immediate, options.change);
  };
  const { drag, setDrag, drop } = useListDrag(items, write);
  const openAt = (event: React.MouseEvent<HTMLElement>, index: number | undefined, item: Item): void => {
    setEditor(listEditorAt(event.currentTarget, index, item));
  };
  const closePending = (): void => {
    setEditor({ kind: 'closed' });
    const item = pendingListItem(editor);
    if (item) {
      write([...items, item], { immediate: true, change: { kind: 'add' } });
    }
  };
  const remove = (index: number): void => {
    if (disabled || items.length <= itemsMin) {
      return;
    }
    setEditor({ kind: 'closed' });
    write(
      items.filter((_, current) => current !== index),
      {
        immediate: true,
        change: { kind: 'remove', index },
      },
    );
  };
  const quote = items.find((item) => item.quote)?.quote ?? items.flatMap((item) => item.fields ?? []).find((field) => field.quote)?.quote ?? '"';
  const kind = listItemKindOf(props.itemType, items, itemShape);
  const plain = kind !== 'object' && !items.some((item) => item.fields !== undefined);
  const blank = (): Item => {
    if (plain) {
      return defaultItemOf(kind, props.itemType, quote);
    }
    return itemShape !== undefined && itemShape.length > 0 ? blankItemOf(itemShape, quote) : blankLike(items);
  };
  return {
    items,
    fallback,
    blank,
    kind,
    itemType: props.itemType,
    quote,
    itemShape,
    projectPath: props.projectPath,
    bindContext: props.bindContext,
    dataContext: props.dataContext,
    editor,
    setEditor,
    drag,
    setDrag,
    write,
    openAt,
    closePending,
    remove,
    drop,
    disabled,
    itemsMin,
    itemsMax,
  };
}
function listEditorAt(trigger: HTMLElement, index: number | undefined, item: Item): Editor {
  const position = listPopupPosition(trigger);
  return index === undefined ? { kind: 'pending', item, position, trigger } : { kind: 'existing', index, position, trigger };
}

function pendingListItem(editor: Editor): Item | undefined {
  if (editor.kind !== 'pending') {
    return undefined;
  }
  const said = editor.item.fields ? editor.item.fields.some(fieldSaid) : String(editor.item.text).trim();
  return said ? editor.item : undefined;
}

function fieldSaid(field: ItemField): boolean {
  if (field.quote !== undefined) {
    return String(field.text).trim() !== '';
  }
  return field.text !== '0' && field.text !== 'false' && field.text !== '';
}

function useListDrag(
  items: readonly Item[],
  write: (
    items: readonly Item[],
    options: {
      readonly immediate: boolean;
      readonly change: ListFieldChange;
    },
  ) => void,
) {
  const [drag, setDrag] = useState<Drag>({ kind: 'idle' });
  const drop = (): void => {
    if (drag.kind === 'dragging' && drag.gap !== undefined) {
      const next = moveItem(items, drag.index, drag.gap);
      if (next.some((item, index) => item !== items[index])) {
        write(next, {
          immediate: true,
          change: { kind: 'move', index: drag.index, gap: drag.gap },
        });
      }
    }
    setDrag({ kind: 'idle' });
  };
  return { drag, setDrag, drop };
}

function listPopupPosition(element: HTMLElement): Position {
  const row = element.closest('.list-field-row') || element;
  const rectangle = row.getBoundingClientRect();
  const width = Math.max(rectangle.width, 220);
  return {
    left: Math.max(8, Math.min(rectangle.left, window.innerWidth - width - 8)),
    top: Math.min(rectangle.bottom + 4, Math.max(60, window.innerHeight - 220)),
    width,
  };
}

type ListState = ReturnType<typeof useListField>;

function ListRow({ item, index, state }: { readonly item: Item; readonly index: number; readonly state: ListState }) {
  const translate = useTranslate();
  const { drag, editor, setDrag, remove, drop } = state;
  const dragging = drag.kind === 'dragging' ? drag.index : undefined;
  const gap = drag.kind === 'dragging' ? drag.gap : undefined;
  const open = editor.kind === 'existing' && editor.index === index;
  return (
    <ListFieldRow
      className={`${dragging === index ? 'is-dragging' : ''} ${gap === index ? 'is-before' : ''} ${
        gap === index + 1 ? 'is-after' : ''
      } ${open ? 'is-open' : ''}`}
      rowProps={{
        draggable: !state.disabled,
        onDragStart: (event) => startListDrag(event, state, index),
        onDragEnd: () => setDrag({ kind: 'idle' }),
        onDragOver: (event) => {
          if (drag.kind === 'idle') {
            return;
          }
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          const gap = event.clientY - box.top < box.height / 2 ? index : index + 1;
          setDrag({ ...drag, gap });
        },
        onDrop: (event) => {
          event.preventDefault();
          event.stopPropagation();
          drop();
        },
      }}
      expanded={open}
      disabled={state.disabled}
      removeDisabled={state.disabled || state.items.length <= state.itemsMin}
      removeLabel={translate('props.list.removeItem', { item: itemLabel(item) || translate('props.list.item') })}
      onOpen={(event) => toggleListRow(event, state, index, item)}
      onRemove={() => remove(index)}
    >
      {itemLabel(item) || <span className="list-field-blank">{translate('props.conditional.empty')}</span>}
    </ListFieldRow>
  );
}

function toggleListRow(event: React.MouseEvent<HTMLElement>, state: ListState, index: number, item: Item): void {
  if (state.editor.kind === 'existing' && state.editor.index === index) {
    state.write(state.items, {
      immediate: true,
      change: { kind: 'edit', index },
    });
    state.setEditor({ kind: 'closed' });
    return;
  }
  state.openAt(event, index, item);
}

function startListDrag(event: React.DragEvent<HTMLElement>, state: ListState, index: number): void {
  if (state.disabled) {
    return;
  }
  state.setDrag({ kind: 'dragging', index, gap: undefined });
  state.setEditor({ kind: 'closed' });
  allowDragEffect(event.dataTransfer, 'move');
  try {
    event.dataTransfer.setData('text/plain', String(index));
  } catch {
  }
}

function ListEditor({ state }: { readonly state: ListState }) {
  const { editor, items, write, setEditor, closePending } = state;
  switch (editor.kind) {
    case 'closed':
      return undefined;
    case 'existing': {
      const item = items[editor.index];
      if (!item) {
        return undefined;
      }
      return (
        <ItemEditor
          item={item}
          shape={state.itemShape}
          kind={state.kind}
          itemType={state.itemType}
          quote={state.quote}
          projectPath={state.projectPath}
          bindContext={state.bindContext}
          dataContext={state.dataContext}
          position={editor.position}
          trigger={editor.trigger}
          onChange={(next) =>
            write(
              items.map((item, index) => (index === editor.index ? next : item)),
              {
                immediate: false,
                change: { kind: 'edit', index: editor.index },
              },
            )
          }
          onClose={() => closeListRowEditor(state)}
        />
      );
    }
    case 'pending':
      return (
        <ItemEditor
          item={editor.item}
          shape={state.itemShape}
          kind={state.kind}
          itemType={state.itemType}
          quote={state.quote}
          projectPath={state.projectPath}
          bindContext={state.bindContext}
          dataContext={state.dataContext}
          position={editor.position}
          trigger={editor.trigger}
          onChange={(item) => setEditor((current) => (current.kind === 'pending' ? { ...current, item } : current))}
          onClose={closePending}
        />
      );
    default: {
      const exhaustive: never = editor;
      return exhaustive;
    }
  }
}

function closeListRowEditor(state: ListState): void {
  if (state.editor.kind === 'existing') {
    state.write(state.items, {
      immediate: true,
      change: { kind: 'edit', index: state.editor.index },
    });
    state.setEditor({ kind: 'closed' });
  }
}
