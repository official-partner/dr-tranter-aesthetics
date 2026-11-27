import { useCodeAccess } from '../../ui/CodeAccess';
import PropTip from './PropTip';
import { ErrorToast } from '../../ui/ErrorToast';
import { dataPickerPosition } from './dataPickerPosition';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { Attr } from '../../../shared/page/pageNode';
import type { PropValues } from './propRules';
import type { RichContext } from './RichContent';
import type { SourceContext, FieldPosition, FieldPickerAt, InsertAPI } from './propBindings';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { scopeChips, scopeCompletions } from '../../editor/dataSuggest';
import StyleEditor from './StyleEditor';
import AssetField from '../../ui/AssetField';
import { looksLikeAssetPath, mediaKindFor } from '../../ui/AssetThumb';
import { BindField, BindHandle, FieldDataPicker, ValueCodeEditor } from './propBindings';
import { BracesIcon, PlusIcon, TrashIcon, ElementImageIcon, MaximizeIcon } from '../../ui/Icons';
import { AttributesPropControl, BoundSpreadRow } from './AttributesPropBinding';
import { CodeInline } from '../../ui/CodeBlock';
import { ComputedField, ConditionalBadge, ConditionalEditor, ConditionalField, useConditionCatalog } from './ConditionalValue';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import type { DescribedTranslator } from '../../lib/i18n/localeContext';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { classListOfAttr, computedOfAttr, conditionalOfAttr, startingConditional, valueLanguageOf } from './conditionalModel';
import { ClassListField } from './ClassListValue';
import { CLASS_LIST_ATTRIBUTE, classListAppended, classListOfferOf, type ClassListOffer } from './classListProp';
import { isReferencePath } from '../../editor/conditionalValue';
import { readAttributesBinding, withDefaultAttribute } from '../../editor/attributesBinding';
import { attributeNameNote } from '../../editor/htmlAttributes';
import { visibleAttributeNames } from '../../../shared/core/internalAttributes';
import {
  type AttributePair,
  type ObjectEntry,
  decodeAttr,
  encodeAttr,
  parseAttrPaste,
  decodeRaw,
  encodeRaw,
  spreadOfName,
  typedAttributeName,
} from './attributeText';
import { commitInPlace } from '../../ui/commitInPlace';
export { parseAttrPaste, parseObjectLiteral, serializeObjectLiteral } from './attributeText';

interface AttributeNode {
  readonly id: string;
  readonly props?: PropValues;
}
interface AttributeEditor extends FieldPosition {
  readonly attr: string | undefined;
}
interface ObjectEditor extends FieldPosition {
  readonly index: number | undefined;
}
export type SetProp = (name: string, value: Attr | undefined, immediate?: boolean) => void;
export type SetProps = (nodeId: string, values: PropValues) => void;
interface ContextProps {
  readonly projectPath?: string | undefined;
  readonly bindContext?: RichContext | undefined;
}
interface AttributesSectionProps extends ContextProps {
  readonly node: AttributeNode;
  readonly names: readonly string[];
  readonly onSetProp: SetProp;
  readonly onSetProps?: SetProps | undefined;
  readonly onRenameProp: (previous: string, next: string) => void;
  readonly tag?: string | undefined;
  readonly reservedNames?: readonly string[] | undefined;
  readonly passedTo?: string | undefined;
  readonly onRenameVariable?: ((rename: { readonly from: string; readonly to: string }) => string | undefined) | undefined;
  readonly onReplaceProps?: ((props: Readonly<Record<string, Attr>>) => void) | undefined;
  readonly onReplaceAttributes?: ((props: Readonly<Record<string, Attr>>) => void) | undefined;
  readonly onSetFrontmatter?: ((source: string) => void) | undefined;
}
interface AttrEditorProps extends ContextProps {
  readonly tag?: string | undefined;
  readonly passedTo?: string | undefined;
  readonly reservedNames?: readonly string[] | undefined;
  readonly pos: FieldPosition;
  readonly triggerRootRef: RefObject<HTMLElement>;
  readonly name: string;
  readonly value: string;
  readonly isNew: boolean;
  readonly takenNames: readonly string[];
  readonly dataContext?: SourceContext | undefined;
  readonly onCommitName: (name: string) => void;
  readonly onCommitSpread?: ((path: string) => void) | undefined;
  readonly spreadPath?: string | undefined;
  readonly onRenameSpread?: ((path: string) => void) | undefined;
  readonly onCommitPair: (name: string, value: string) => void;
  readonly onCommitMany: (pairs: readonly AttributePair[]) => void;
  readonly onChangeValue: (value: string) => void;
  readonly onApplyValue: (value: Attr | undefined) => void;
  readonly classList?: ClassListOffer | undefined;
  readonly onClose: () => void;
}
interface ObjectAttrsFieldProps extends ContextProps {
  readonly pill: ReactNode;
  readonly menu: ReactNode;
  readonly entries: readonly ObjectEntry[];
  readonly onCommit: (entries: readonly ObjectEntry[]) => void;
}

export function AttributesSection(props: AttributesSectionProps) {
  const translate = useTranslate();
  const state = useAttributesSection(props);
  const { node, onSetProp, editor, setEditor, listRef, openEditor, tag, onReplaceProps, bindContext } = state;
  const restLocal = bindContext?.newProp?.restLocal;
  const binding = restLocal === undefined ? undefined : readAttributesBinding(node.props, restLocal);
  const names = visibleAttributeNames(state.names);

  return (
    <div className="props-field" ref={listRef}>
      {}
      <div className="props-label-row attrs-label-row">
        <span className="prop-label">
          <BracesIcon size={12} className="prop-label-icon" />
          {translate('props.attributes.title')}
        </span>
        {state.passedTo !== undefined && <span className="attrs-tag-type">{translate('props.attributes.tagType', { tag: state.passedTo })}</span>}
        {tag !== undefined && onReplaceProps !== undefined && (
          <AttributesPropControl
            props={node.props}
            tag={tag}
            bindContext={bindContext}
            onReplaceProps={onReplaceProps}
            onSetFrontmatter={state.onSetFrontmatter}
            onRenameVariable={state.onRenameVariable}
          />
        )}
        <button className="ghost" title={translate('props.attributes.add')} data-attribute-editor-trigger onClick={() => openEditor(undefined)}>
          <PlusIcon size={12} />
        </button>
      </div>

      {names.length > 0 && (
        <div className="attrs-list">
          {names.map((name) => {
            const value = node.props?.[name];
            if (value?.type === 'spread' && binding !== undefined && value.value === restLocal) {
              return <BoundSpreadRow key={name} local={value.value} />;
            }
            if (value?.type === 'spread') {
              return <SpreadRow key={name} name={name} spread={value.value} state={state} />;
            }
            return (
              <div
                key={name}
                className={`attr-row pair ${editor?.attr === name ? 'editing' : ''}`}
                data-attribute-editor-trigger
                onClick={() => openEditor(name)}
              >
                <span className="attr-name">{name}</span>
                <span className="attr-eq">=</span>
                <AttributeRowValue name={name} value={value} />
                <button
                  className="row-action"
                  title={translate('props.attributes.delete')}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (editor?.attr === name) {
                      setEditor(undefined);
                    }
                    onSetProp(name, undefined, true);
                  }}
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <AttributesSectionPopup state={state} />
    </div>
  );
}

function AttributeRowValue({ name, value }: { readonly name: string; readonly value: Attr | undefined }) {
  const translate = useTranslate();
  if (conditionalOfAttr(value) !== undefined) {
    return (
      <span className="attr-value">
        <ConditionalBadge />
      </span>
    );
  }
  if (name === 'class:list' && classListOfAttr(value) !== undefined) {
    return (
      <span className="attr-value">
        <ConditionalBadge label={translate('props.classList.title')} />
      </span>
    );
  }
  if (computedOfAttr(value) !== undefined) {
    return (
      <span className="attr-value">
        <ConditionalBadge label={translate('props.conditional.computed')} tone="computed" />
      </span>
    );
  }
  return <span className="attr-value">{decodeAttr(value)}</span>;
}

function SpreadRow({ name, spread, state }: { readonly name: string; readonly spread: string; readonly state: AttributesState }) {
  const translate = useTranslate();
  const { node, onReplaceAttributes, editor, openEditor } = state;
  assert(name.startsWith('...'), 'SpreadRow: a spread is keyed by its source');
  return (
    <div
      className={`attr-row spread ${editor?.attr === name ? 'editing' : ''}`}
      title={translate('props.attributes.spreadTitle')}
      data-attribute-editor-trigger
      onClick={() => openEditor(name)}
    >
      <span className="attr-name">
        <CodeInline text={`{...${spread}}`} language="javascript" />
      </span>
      {onReplaceAttributes !== undefined && (
        <button
          className="row-action"
          title={translate('props.attributes.deleteSpread')}
          aria-label={translate('props.attributes.deleteSpreadNamed', { spread: `{...${spread}}` })}
          onClick={(event) => {
            event.stopPropagation();
            if (editor?.attr === name) {
              state.setEditor(undefined);
            }
            onReplaceAttributes(withoutAttribute(node.props, name));
          }}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  );
}

export function withSpreadAdded(props: PropValues | undefined, path: string): Readonly<Record<string, Attr>> {
  const key = `...${path}`;
  const out: Record<string, Attr> = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value !== undefined) {
      Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  if (!Object.hasOwn(out, key)) {
    Object.defineProperty(out, key, { value: { type: 'spread', value: path }, enumerable: true, writable: true, configurable: true });
  }
  assert(out[key]?.type === 'spread', 'withSpreadAdded: the spread is there');
  assert(Object.keys(out).length <= LIMITS.attrsPerNodeMax + 1, 'withSpreadAdded: attribute limit exceeded');
  return out;
}

export function withSpreadRenamed(props: PropValues | undefined, from: string, path: string): Readonly<Record<string, Attr>> {
  const key = `...${path}`;
  assert(Object.hasOwn(props ?? {}, from), 'withSpreadRenamed: the spread is there');
  const out: Record<string, Attr> = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    const [slot, entry]: readonly [string, Attr | undefined] = name === from ? [key, { type: 'spread', value: path }] : [name, value];
    if (entry !== undefined) {
      Object.defineProperty(out, slot, { value: entry, enumerable: true, writable: true, configurable: true });
    }
  }
  assert(Object.keys(out).indexOf(key) === Object.keys(props ?? {}).indexOf(from), 'withSpreadRenamed: the spread keeps its place');
  return out;
}

export function withoutAttribute(props: PropValues | undefined, name: string): Readonly<Record<string, Attr>> {
  const out: Record<string, Attr> = {};
  const entries = Object.entries(props ?? {});
  assert(entries.length <= LIMITS.attrsPerNodeMax, 'withoutAttribute: attribute limit exceeded');
  for (const [key, value] of entries) {
    if (key !== name && value !== undefined) {
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  assert(!Object.hasOwn(out, name), 'withoutAttribute: the attribute is gone');
  return out;
}

function useAttributesSection(props: AttributesSectionProps) {
  const { names } = props;
  assert(names.length <= LIMITS.attrsPerNodeMax, 'Attributes: name limit exceeded');
  const onSetProp: SetProp = (name, value, immediate) => {
    const placed = value === undefined ? undefined : defaultPlacement(props, name, value);
    if (placed === undefined) {
      props.onSetProp(name, value, immediate);
    } else {
      props.onReplaceProps?.(placed);
    }
  };
  const [editor, setEditor] = useState<AttributeEditor | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const openEditor = (attr: string | undefined) => {
    const rect = listRef.current?.getBoundingClientRect();
    setEditor((current) =>
      current !== undefined && current.attr === attr
        ? undefined
        : {
            attr,
            top: Math.min((rect?.bottom ?? 200) + 6, window.innerHeight - 150),
            left: rect?.left ?? 0,
            width: rect?.width ?? 240,
          },
    );
  };

  return { ...props, onSetProp, editor, setEditor, listRef, openEditor };
}
type AttributesState = ReturnType<typeof useAttributesSection>;

function defaultPlacement(props: AttributesSectionProps, name: string, value: Attr): Readonly<Record<string, Attr>> | undefined {
  const local = props.bindContext?.newProp?.restLocal;
  if (local === undefined || props.onReplaceProps === undefined || name.startsWith('...')) {
    return undefined;
  }
  if (Object.hasOwn(props.node.props ?? {}, name)) {
    return undefined;
  }
  if (readAttributesBinding(props.node.props, local) === undefined) {
    return undefined;
  }
  const out = withDefaultAttribute(props.node.props, local, name, value);
  assert(Object.keys(out).indexOf(name) < Object.keys(out).indexOf(`...${local}`), 'defaultPlacement: the new attribute is before the spread');
  return out;
}
function AttributesSectionPopup({ state }: { readonly state: AttributesState }) {
  const { node, projectPath, bindContext, onSetProp, onRenameProp, editor, setEditor } = state;
  if (!editor) {
    return undefined;
  }
  const value = editor.attr ? node.props?.[editor.attr] : undefined;
  const spreadPath = value?.type === 'spread' ? value.value : undefined;
  const onReplaceAttributes = state.onReplaceAttributes;
  return (
    <AttrEditor
      key={editor.attr ?? '__new'}
      pos={editor}
      triggerRootRef={state.listRef}
      projectPath={projectPath ?? undefined}
      bindContext={bindContext}
      dataContext={bindContext}
      tag={state.tag}
      passedTo={state.passedTo}
      reservedNames={state.reservedNames}
      name={spreadPath === undefined ? (editor.attr ?? '') : `{...${spreadPath}}`}
      value={spreadPath === undefined ? decodeAttr(value) : ''}
      spreadPath={spreadPath}
      classList={
        editor.attr === CLASS_LIST_ATTRIBUTE
          ? classListOfferOf(
              { kind: state.tag === undefined ? 'component' : 'element', name: state.tag ?? '', props: node.props },
              bindContext?.newProp,
              onReplaceAttributes === undefined
                ? undefined
                : (props) => {
                    setEditor(undefined);
                    onReplaceAttributes(props);
                  },
            )
          : undefined
      }
      onRenameSpread={
        onReplaceAttributes === undefined || editor.attr === undefined
          ? undefined
          : (path) => {
              const from = editor.attr;
              if (from === undefined) {
                return;
              }
              onReplaceAttributes(withSpreadRenamed(node.props, from, path));
              setEditor((current) => (current ? { ...current, attr: `...${path}` } : undefined));
            }
      }
      isNew={editor.attr === undefined}
      takenNames={Object.keys(node.props ?? {}).filter((key) => key !== editor.attr)}
      onCommitSpread={
        onReplaceAttributes === undefined
          ? undefined
          : (path) => {
              setEditor(undefined);
              onReplaceAttributes(withSpreadAdded(node.props, path));
            }
      }
      onCommitName={(newName) => {
        const clean = newName.trim();
        if (editor.attr === undefined) {
          if (clean && !node.props?.[clean]) {
            onSetProp(clean, { type: 'bare' }, true);
            setEditor((current) => (current ? { ...current, attr: clean } : undefined));
          }
        } else if (clean && clean !== editor.attr) {
          onRenameProp(editor.attr, clean);
          setEditor((current) => (current ? { ...current, attr: clean } : undefined));
        }
      }}
      onChangeValue={(text) => {
        if (editor.attr) {
          onSetProp(editor.attr, encodeAttr(text));
        }
      }}
      onApplyValue={(next) => {
        if (editor.attr) {
          onSetProp(editor.attr, next, true);
          if (next === undefined) {
            setEditor(undefined);
          }
        }
      }}
      onCommitPair={(attrName, text) => {
        const clean = attrName.trim();
        if (!clean) {
          return;
        }
        if (editor.attr && editor.attr !== clean) {
          onRenameProp(editor.attr, clean);
        }
        onSetProp(clean, encodeAttr(text), true);
        setEditor((current) => (current ? { ...current, attr: clean } : undefined));
      }}
      onCommitMany={(pairs) => attributesCommitMany(state, pairs)}
      onClose={() => setEditor(undefined)}
    />
  );
}

function attributesCommitMany(state: AttributesState, pairs: readonly AttributePair[]): void {
  const { node, onSetProp, onSetProps, setEditor } = state;

  const patch: Record<string, Attr> = {};
  for (const { name: attrName, value: text } of pairs) {
    const clean = attrName.trim();
    if (clean) {
      patch[clean] = encodeAttr(text);
    }
  }
  if (!Object.keys(patch).length) {
    return;
  }
  if (onSetProps) {
    onSetProps(node.id, patch);
  } else {
    for (const [key, value] of Object.entries(patch)) {
      onSetProp(key, value, true);
    }
  }
  setEditor(undefined);
}

function AttrEditor(props: AttrEditorProps) {
  const translate = useTranslate();
  const state = useAttrEditor(props);
  const { ref, pos: position, isStyleValue, assetMode, setAssetMode, spreadName } = state;

  return (
    <div ref={ref} className="attr-editor" style={{ top: position.top, left: position.left, width: position.width }}>
      <AttributeName state={state} />
      {}
      {spreadName.kind === 'none' && state.spreadPath === undefined && (
        <div className={`attr-editor-row ${isStyleValue || assetMode ? 'top' : ''}`} ref={state.valueRowRef}>
          <span>{translate('props.attributes.value')}</span>
          <AttributeValue state={state} />
          <AttributePopups state={state} />
          <button
            className={`attr-asset-toggle ${assetMode ? 'on' : ''}`}
            title={assetMode ? translate('props.attributes.plainValue') : translate('props.attributes.chooseFile')}
            onClick={() => setAssetMode((previous) => !previous)}
          >
            <ElementImageIcon size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function useAttrEditor(props: AttrEditorProps) {
  const { value, isNew, bindContext, onCommitName, onCommitSpread, onClose, triggerRootRef } = props;
  const { name } = props;
  const [draftName, setDraftName] = useState(name);
  const [draftValue, setDraftValue] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<FieldPickerAt | undefined>(undefined);
  const [bigAt, setBigAt] = useState<FieldPosition | undefined>(undefined);
  const scope = scopeCompletions(bindContext || {});
  const scopeNames = new Set(scope.map((completion) => completion.label.split('.')[0] ?? ''));
  const chipsInScope = (text: string) => scopeChips(text, scopeNames);
  const bindApiRef = useRef<InsertAPI | undefined>(undefined);
  const valueRowRef = useRef<HTMLDivElement>(null);
  const [conditionalOpen, setConditionalOpen] = useState(false);

  const [isExpr] = useState(() => /^\{[\s\S]*\}$/.test(value));
  const isStyleName = draftName.trim().toLowerCase() === 'style';

  const [assetMode, setAssetMode] = useState(() => !isStyleName && looksLikeAssetPath(value));

  const isStyleValue = isStyleName && !isExpr && !assetMode;

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const focusValue = !isNew && !mounted.current;

  const spreadName = spreadOfName(draftName);
  const commitSpread = (path: string): void => {
    if (props.takenNames.includes(`...${path}`)) {
      return;
    }
    if (isNew && onCommitSpread !== undefined) {
      onCommitSpread(path);
    } else if (props.spreadPath !== undefined && props.spreadPath !== path && props.onRenameSpread !== undefined) {
      props.onRenameSpread(path);
    }
  };
  const commitName = () => {
    switch (spreadName.kind) {
      case 'none':
        if (props.spreadPath === undefined) {
          onCommitName(draftName);
        }
        return;
      case 'spread':
        commitSpread(spreadName.path);
        return;
      case 'invalid':
        return;
      default: {
        const exhaustive: never = spreadName;
        return exhaustive;
      }
    }
  };

  useAttrEditorDismiss(ref, triggerRootRef, onClose);
  return {
    ...props,
    name,
    spreadName,
    commitSpread,
    draftName,
    setDraftName,
    draftValue,
    setDraftValue,
    ref,
    insertAt,
    setInsertAt,
    bigAt,
    setBigAt,
    scope,
    chipsInScope,
    bindApiRef,
    valueRowRef,
    conditionalOpen,
    setConditionalOpen,
    assetMode,
    setAssetMode,
    isStyleValue,
    focusValue,
    commitName,
  };
}
type AttributeState = ReturnType<typeof useAttrEditor>;
function useAttrEditorDismiss(ref: RefObject<HTMLElement>, triggerRootRef: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof window.Node)) {
        return;
      }
      if (ref.current?.contains(target)) {
        return;
      }
      if (target instanceof window.Element && target.closest('[data-popup-phase]') !== null) {
        return;
      }
      const trigger = target instanceof window.Element ? target.closest('[data-attribute-editor-trigger]') : undefined;
      if (trigger && triggerRootRef.current?.contains(trigger)) {
        return;
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('[data-popup-phase]') === null) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, ref, triggerRootRef]);
}
type NameWords = { readonly kind: 'advice' | 'refusal'; readonly text: string } | undefined;
function nameWords(state: AttributeState, translate: Translator, translateDescribed: DescribedTranslator): NameWords {
  const { spreadName } = state;
  if (spreadName.kind === 'invalid') {
    return { kind: 'refusal', text: translateDescribed(spreadName) };
  }
  if (spreadName.kind === 'spread') {
    const available = state.spreadPath !== undefined || state.onCommitSpread !== undefined;
    return {
      kind: 'advice',
      text: available
        ? `{...${spreadName.path}} ${translate('props.attributes.spreadPasses', { path: spreadName.path })}`
        : translate('props.attributes.spreadAdded'),
    };
  }
  if (state.spreadPath !== undefined) {
    return { kind: 'refusal', text: translate('props.attributes.spreadName') };
  }
  const advice = attributeNameNote(
    state.draftName,
    {
      tag: state.tag,
      passedTo: state.passedTo,
      reserved: state.reservedNames ?? [],
      own: state.isNew ? undefined : state.name,
      taken: state.takenNames,
    },
    translate,
  );
  return advice === undefined ? undefined : { kind: 'advice', text: advice };
}
function AttributeName({ state }: { readonly state: AttributeState }) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { isNew, draftName, setDraftName, setDraftValue, onCommitPair, onCommitMany } = state;
  const words = nameWords(state, translate, translateDescribed);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const commitName = (): void => {
    setRefused(words?.kind === 'refusal' ? words.text : undefined);
    state.commitName();
  };
  const nameRef = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<FieldPosition | undefined>(undefined);
  const spreading = state.spreadPath !== undefined || state.spreadName.kind !== 'none';
  return (
    <div className="attr-editor-row">
      <span>
        {translate('props.attributes.name')}
        <PropTip text={words?.text} />
      </span>
      <ErrorToast message={refused} />
      <div className="attr-name-field" ref={nameRef}>
        <input
          autoFocus={isNew}
          value={draftName}
          placeholder="data-attribute"
          aria-invalid={words?.kind === 'refusal'}
          spellCheck={false}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (!text || !/=/.test(text)) {
              return;
            }
            const pairs = parseAttrPaste(text);
            if (!pairs.length) {
              return;
            }
            event.preventDefault();
            const pair = pairs[0];
            if (pairs.length === 1 && pair) {
              setDraftName(pair.name);
              setDraftValue(pair.value);
              onCommitPair(pair.name, pair.value);
            } else {
              onCommitMany(pairs);
            }
          }}
          onChange={(event) => {
            setRefused(undefined);
            setDraftName(typedAttributeName(event.target.value));
          }}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitName();
              if (isNew) {
                event.currentTarget.blur();
              } else {
                commitInPlace(event.currentTarget);
              }
            }
          }}
        />
        {spreading && (
          <BindHandle
            active={picker !== undefined}
            onOpen={() => {
              const bounds = nameRef.current?.getBoundingClientRect();
              setPicker(picker !== undefined || bounds === undefined ? undefined : dataPickerPosition(bounds));
            }}
          />
        )}
      </div>
      {picker !== undefined && (
        <FieldDataPicker
          pos={picker}
          bindContext={state.bindContext}
          current={state.spreadName.kind === 'spread' ? state.spreadName.path : undefined}
          onPick={(path) => {
            setPicker(undefined);
            if (isReferencePath(path)) {
              setDraftName(`{...${path}}`);
              state.commitSpread(path);
            }
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
    </div>
  );
}
function AttributeValue({ state }: { readonly state: AttributeState }) {
  const { isStyleValue, draftValue, focusValue, setDraftValue, onChangeValue, assetMode, projectPath } = state;
  const conditional = conditionalOfAttr(encodeAttr(draftValue));
  const classList = state.draftName === 'class:list' ? classListOfAttr(encodeAttr(draftValue)) : undefined;
  const computed = computedOfAttr(encodeAttr(draftValue));
  const [codeShown, setCodeShown] = useState(false);
  return isStyleValue ? (
    <StyleEditor
      value={draftValue}
      autoFocus={focusValue}
      onChange={(next) => {
        setDraftValue(next);
        onChangeValue(next);
      }}
    />
  ) : assetMode ? (
    <div className="attr-asset">
      <AssetField
        value={draftValue}
        initialMode="asset"
        showModeToggle={false}
        mediaKind={mediaKindFor(draftValue)}
        projectPath={projectPath ?? ''}
        onChange={(value) => {
          setDraftValue(value);
          onChangeValue(value);
        }}
      />
    </div>
  ) : classList !== undefined ? (
    <div className="attr-value-field">
      <ClassListField model={classList} value={encodeAttr(draftValue)} bindContext={state.bindContext} onApply={(next) => applyValue(state, next)} />
      {state.classList !== undefined && <ClassListHandle state={state} />}
    </div>
  ) : conditional !== undefined ? (
    <ConditionalField
      model={conditional}
      value={encodeAttr(draftValue)}
      bindContext={state.bindContext}
      language={valueLanguageOf(state.draftName)}
      onApply={(next) => applyValue(state, next)}
    />
  ) : computed !== undefined && !codeShown ? (
    <ComputedField code={computed} onEditCode={() => setCodeShown(true)} />
  ) : (
    <AttributeBinding state={state} />
  );
}
function AttributeBinding({ state }: { readonly state: AttributeState }) {
  const translate = useTranslate();
  const allowCode = useCodeAccess();
  const { draftValue, setDraftValue, onChangeValue, bindContext, dataContext, bindApiRef, insertAt, setInsertAt, ref, setBigAt } = state;
  const valueRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={valueRef} className="attr-value-field">
        <BindField
          value={draftValue === '' ? { type: 'string', value: '' } : encodeAttr(draftValue)}
          placeholder={translate('props.attributes.typeOrInsert')}
          bindContext={bindContext}
          dataContext={dataContext}
          attributeName={state.draftName}
          elementName={state.tag}
          wrapCode
          apiRef={bindApiRef}
          onChange={(next) => {
            const text = decodeAttr(next);
            setDraftValue(text);
            onChangeValue(text);
          }}
        />
        {}
        <BindHandle
          active={!!insertAt}
          onOpen={(host, focus) => {
            if (insertAt) {
              setInsertAt(undefined);
              return;
            }
            const rect = (host || ref.current)?.getBoundingClientRect();
            if (!rect) {
              return;
            }
            setInsertAt({ ...dataPickerPosition(rect), focus });
          }}
        />
      </div>
      {allowCode && (
        <button
          type="button"
          className="attr-expand-toggle"
          title={translate('props.attributes.expand')}
          aria-label={translate('props.attributes.expand')}
          onClick={() => openExpandedAttribute(valueRef.current ?? undefined, setBigAt)}
        >
          <MaximizeIcon size={12} />
        </button>
      )}
    </>
  );
}

function expandedAttributeEditorPosition(host: HTMLElement): FieldPosition {
  const rectangle = host.getBoundingClientRect();
  const viewportWidth = Math.max(window.innerWidth, 32);
  const width = Math.min(Math.max(rectangle.width, 760), viewportWidth - 16);
  return {
    left: Math.max(8, Math.min(rectangle.left, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(rectangle.top, window.innerHeight - 320)),
    width,
  };
}
function AttributePopups({ state }: { readonly state: AttributeState }) {
  const { bigAt, draftName, draftValue, scope, chipsInScope, bindContext, setDraftValue, onChangeValue, setBigAt, insertAt, setInsertAt, bindApiRef } = state;
  const catalog = useConditionCatalog(bindContext);
  const start = bindContext?.newProp === undefined ? undefined : startingConditional(encodeAttr(draftValue), catalog);
  return (
    <>
      {state.conditionalOpen && start !== undefined && (
        <ConditionalEditor
          anchorRef={state.valueRowRef}
          start={start}
          model={undefined}
          value={encodeAttr(draftValue)}
          bindContext={bindContext}
          language={valueLanguageOf(draftName)}
          shapes="rich"
          onApply={(next) => applyValue(state, next)}
          onClose={() => state.setConditionalOpen(false)}
        />
      )}
      {bigAt ? (
        <ValueCodeEditor
          pos={bigAt}
          name={draftName || 'value'}
          value={draftValue}
          scope={scope}
          chipsOf={chipsInScope}
          bindContext={bindContext}
          onChange={(text) => {
            setDraftValue(text);
            onChangeValue(text);
          }}
          onClose={() => setBigAt(undefined)}
        />
      ) : undefined}
      {insertAt ? (
        <FieldDataPicker
          pos={insertAt}
          bindContext={bindContext}
          seed={{ fit: 'text', label: draftName || 'value', value: draftValue.startsWith('{') ? '' : draftValue }}
          classList={draftName === CLASS_LIST_ATTRIBUTE ? state.classList : undefined}
          onBindNew={(path) => {
            setInsertAt(undefined);
            setDraftValue(`{${path}}`);
            onChangeValue(`{${path}}`);
          }}
          onPick={(path) => {
            setInsertAt(undefined);
            if (insertAt.focus.kind === 'focused' && bindApiRef.current?.insert) {
              bindApiRef.current.insert(path);
              return;
            }
            const appended = draftName === CLASS_LIST_ATTRIBUTE && draftValue !== '' ? classListAppended(encodeAttr(draftValue), path) : undefined;
            if (appended !== undefined) {
              applyValue(state, appended);
              return;
            }
            const text = `{${path}}`;
            setDraftValue(text);
            onChangeValue(text);
          }}
          onConditional={
            start === undefined
              ? undefined
              : () => {
                  setInsertAt(undefined);
                  state.setConditionalOpen(true);
                }
          }
          onClose={() => setInsertAt(undefined)}
        />
      ) : undefined}
    </>
  );
}

function ClassListHandle({ state }: { readonly state: AttributeState }) {
  const { insertAt, setInsertAt, ref } = state;
  return (
    <BindHandle
      active={insertAt !== undefined}
      onOpen={(host, focus) => {
        if (insertAt !== undefined) {
          setInsertAt(undefined);
          return;
        }
        const rectangle = (host ?? ref.current)?.getBoundingClientRect();
        if (rectangle !== undefined) {
          setInsertAt({ ...dataPickerPosition(rectangle), focus });
        }
      }}
    />
  );
}

function applyValue(state: AttributeState, next: Attr | undefined): void {
  state.setDraftValue(decodeAttr(next));
  state.onApplyValue(next);
}

export function ObjectAttrsField(props: ObjectAttrsFieldProps) {
  const translate = useTranslate();
  const state = useObjectAttrsField(props);
  const { pill, menu, entries, onCommit, editor, setEditor, listRef, openEditor } = state;

  return (
    <div className="props-field" ref={listRef}>
      <div className="props-label-row">
        {pill}
        <button className="ghost" title={translate('props.attributes.add')} data-attribute-editor-trigger onClick={() => openEditor(undefined)}>
          <PlusIcon size={12} />
        </button>
        {menu}
      </div>

      {entries.length > 0 && (
        <div className="attrs-list">
          {entries.map((en, i) => (
            <div
              key={`${en.key}-${i}`}
              className={`attr-row ${editor?.index === i ? 'editing' : ''}`}
              data-attribute-editor-trigger
              onClick={() => openEditor(i)}
            >
              <span className="attr-name">{en.key}</span>
              <span className="attr-eq">=</span>
              <span className="attr-value">{decodeRaw(en.raw)}</span>
              <button
                className="row-action"
                title={translate('props.attributes.delete')}
                onClick={(event) => {
                  event.stopPropagation();
                  if (editor?.index === i) {
                    setEditor(undefined);
                  }
                  onCommit(entries.filter((_, j) => j !== i));
                }}
              >
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ObjectAttrsFieldPopup state={state} />
    </div>
  );
}

function useObjectAttrsField(props: ObjectAttrsFieldProps) {
  const { entries } = props;
  assert(entries.length <= LIMITS.attrsPerNodeMax, 'Object attributes: entry limit exceeded');
  const [editor, setEditor] = useState<ObjectEditor | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const openEditor = (index: number | undefined) => {
    const rect = listRef.current?.getBoundingClientRect();
    setEditor((current) =>
      current !== undefined && current.index === index
        ? undefined
        : {
            index,
            top: Math.min((rect?.bottom ?? 200) + 6, window.innerHeight - 150),
            left: rect?.left ?? 0,
            width: rect?.width ?? 240,
          },
    );
  };

  return { ...props, editor, setEditor, listRef, openEditor };
}
type ObjectAttributesState = ReturnType<typeof useObjectAttrsField>;
function ObjectAttrsFieldPopup({ state }: { readonly state: ObjectAttributesState }) {
  const { entries, bindContext, projectPath, onCommit, editor, setEditor } = state;
  if (!editor) {
    return undefined;
  }
  return (
    <AttrEditor
      key={editor.index ?? '__new'}
      pos={editor}
      triggerRootRef={state.listRef}
      projectPath={projectPath ?? undefined}
      bindContext={bindContext}
      dataContext={bindContext}
      name={editor.index !== undefined ? (entries[editor.index]?.key ?? '') : ''}
      value={editor.index !== undefined ? decodeRaw(entries[editor.index]?.raw ?? '') : ''}
      takenNames={entries.filter((_, index) => index !== editor.index).map((entry) => entry.key)}
      isNew={editor.index === undefined}
      onCommitName={(newName) => {
        const clean = newName.trim();
        if (!clean) {
          return;
        }
        if (editor.index === undefined) {
          if (entries.some((en) => en.key === clean)) {
            return;
          }
          onCommit([...entries, { key: clean, raw: 'true' }]);
          setEditor((current) => (current ? { ...current, index: entries.length } : undefined));
        } else if (clean !== entries[editor.index]?.key) {
          onCommit(entries.map((en, i) => (i === editor.index ? { ...en, key: clean } : en)));
        }
      }}
      onChangeValue={(text) => {
        if (editor.index !== undefined) {
          onCommit(entries.map((en, i) => (i === editor.index ? { ...en, raw: encodeRaw(text) } : en)));
        }
      }}
      onApplyValue={(next) => {
        if (editor.index === undefined) {
          return;
        }
        if (next === undefined) {
          onCommit(entries.filter((_, i) => i !== editor.index));
          setEditor(undefined);
          return;
        }
        const text = decodeAttr(next);
        onCommit(entries.map((en, i) => (i === editor.index ? { ...en, raw: encodeRaw(text) } : en)));
      }}
      onCommitPair={(name, value) => {
        const entry = { key: name.trim(), raw: encodeRaw(value) };
        if (!entry.key) {
          return;
        }
        const index = editor.index ?? entries.length;
        const next = entries.map((current, at) => (at === index ? entry : current));
        if (index === entries.length) {
          next.push(entry);
        }
        onCommit(next);
        setEditor((current) => (current ? { ...current, index } : undefined));
      }}
      onCommitMany={(pairs) => {
        const replacements = new Map(entries.map((entry) => [entry.key, entry]));
        for (const pair of pairs) {
          replacements.set(pair.name, { key: pair.name, raw: encodeRaw(pair.value) });
        }
        onCommit([...replacements.values()]);
        setEditor(undefined);
      }}
      onClose={() => setEditor(undefined)}
    />
  );
}

function openExpandedAttribute(host: HTMLElement | undefined, open: (position: FieldPosition) => void): void {
  if (host) {
    open(expandedAttributeEditorPosition(host));
  }
}
