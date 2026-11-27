import { useTranslate } from '../../lib/i18n/useTranslate';
import { ErrorToast } from '../../ui/ErrorToast';
import Popup from '../../ui/Popup';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ImportDecl, MapNode } from '../../../shared/page/pageNode';
import type { LoopReadInput } from '../../editor/loopQueryRead';
import type { TreeNode } from '../../editor/dataSuggest';
import type { SourcePickerData } from './LoopSourcePicker';
import LoopSettings, { type LoopListOption, type LoopSettingsProps } from './LoopSettings';
import type { RichContext } from './RichContent';
import type { FieldPosition, SourceContext } from './propBindings';
import { assert } from '../../../shared/core/assert';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';
import { splitDestructuredHead } from '../../editor/loopBindings';
import { LIMITS } from '../../../shared/core/limits';
import { HTML_TAGS } from '../../editor/elementSchemas';
import { dataTree, listsOnly } from '../../editor/dataSuggest';
import ExprInput from '../../ui/ExprInput';
import { SourceEditButton } from './propBindings';
import PropTip from './PropTip';
import { elementIcon, astroAssetIcon, LayoutIcon, ElementComponentIcon, CodeIcon, TagIcon } from '../../ui/Icons';

export interface Rename {
  readonly from: string;
  readonly to: string;
}
export type SetText = (value: string, renames?: readonly Rename[]) => void;
interface MapEditorProps {
  readonly node: MapNode;
  readonly loopContext?: RichContext | undefined;
  readonly bindContext?: RichContext | undefined;
  readonly dataContext?: SourceContext | undefined;
  readonly onSetText: SetText;
  readonly imports?: readonly ImportDecl[] | undefined;
  readonly projectPath?: string | undefined;
  readonly onCommitHead?: ((value: string, renames: readonly Rename[]) => string | undefined) | undefined;
  readonly onSetLoopSource?: LoopSettingsProps['onApply'] | undefined;
  readonly onEditLoopProperty?: LoopSettingsProps['onEditProperty'];
}
export interface TagOption {
  readonly name: string;
  readonly kind?: string;
  readonly unlisted?: boolean;
}
export interface TagFieldProps {
  readonly tag: string;
  readonly options?: readonly TagOption[] | undefined;
  readonly onChangeTag: (name: string) => void | boolean | Promise<void | boolean>;
}
const noLabelActivation = (event: React.MouseEvent<HTMLLabelElement>) => event.preventDefault();
export function parseMapHead(head: string): { readonly data: string; readonly item: string | undefined; readonly index: string } | undefined {
  assert(head.length <= LIMITS.nodeValueCharsMax, 'MapEditor: head limit exceeded');
  const match = String(head)
    .trim()
    .match(/^([\s\S]+?)\.map\(\s*(?:\(\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)|([\w$]+))\s*=>\s*\($/);
  if (match?.[1]) {
    const item = match[2] || match[4];
    return item ? { data: match[1].trim(), item, index: match[3] || '' } : undefined;
  }
  const destructured = splitDestructuredHead(head);
  return destructured === undefined ? undefined : { data: destructured.data, item: undefined, index: destructured.index };
}

export function customLoopReason(node: Pick<MapNode, 'head' | 'bodyParts'>): MessageKey {
  if (node.bodyParts !== undefined) {
    return 'props.map.why.statements';
  }
  if (/\.map\(\s*\(?\s*\{[\s\S]*\}[\s\S]*=>/.test(node.head)) {
    return 'props.map.why.nestedPattern';
  }
  return 'props.map.why.shape';
}

export function headRenames(before: string, after: string): readonly Rename[] {
  assert(before.length <= LIMITS.nodeValueCharsMax, 'MapEditor: head limit exceeded');
  assert(after.length <= LIMITS.nodeValueCharsMax, 'MapEditor: head limit exceeded');
  const previous = parseMapHead(before);
  const next = parseMapHead(after);
  if (!previous || !next) {
    return [];
  }
  const renames: Rename[] = [];
  for (const key of ['item', 'index'] as const) {
    if (previous[key] && next[key] && previous[key] !== next[key]) {
      renames.push({ from: previous[key], to: next[key] });
    }
  }
  assert(renames.length <= 2, 'MapEditor: rename count exceeded');
  return renames;
}

export function MapEditor(props: MapEditorProps) {
  const translate = useTranslate();
  const { node, onSetText, onCommitHead } = props;
  const splittable = node.bodyParts === undefined && parseMapHead(node.head) !== undefined;
  const [draft, setDraft] = useState(node.head);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDraft(node.head);
    setProblem(undefined);
  }, [node.head]);
  const commitCode = (value: string): void => {
    if (value === node.head) {
      setProblem(undefined);
      return;
    }
    if (value.length > LIMITS.nodeValueCharsMax) {
      setProblem(translate('props.map.tooLong'));
      return;
    }
    const renames = node.bodyParts === undefined ? headRenames(node.head, value) : [];
    if (onCommitHead === undefined) {
      onSetText(value, renames);
      return;
    }
    setProblem(onCommitHead(value, renames));
  };
  const code = (
    <>
      <div className="props-field loop-settings-row">
        <label onClick={noLabelActivation}>
          <span className="prop-label">
            <CodeIcon size={12} className="prop-label-icon" />
            {translate('props.map.code')}
          </span>
          {}
          {!splittable && <PropTip text={translate(customLoopReason(node))} />}
        </label>
        <ExprInput
          value={draft}
          syncValue={node.head}
          invalid={problem !== undefined}
          onChange={(text) => {
            setDraft(text);
            setProblem(undefined);
          }}
          onCommit={commitCode}
        />
      </div>
      <ErrorToast message={problem} />
    </>
  );
  return splittable ? <MapListSettings props={props}>{code}</MapListSettings> : <>{code}</>;
}

function tagOptionIcon(option: TagOption) {
  if (option.kind === 'astroAsset') {
    return astroAssetIcon(option.name, 13);
  }
  if (option.kind === 'layout') {
    return <LayoutIcon size={13} style={{ color: '#79e09c' }} />;
  }
  if (option.kind === 'component') {
    return <ElementComponentIcon size={13} style={{ color: '#79e09c' }} />;
  }
  return elementIcon(option.name, 13);
}

function useTagModel({ tag, options }: TagFieldProps) {
  const [draft, setDraft] = useState(tag);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupPosition, setPopupPosition] = useState<FieldPosition | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(tag);
  const draftRef = useRef(tag);
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  useEffect(() => {
    committedRef.current = tag;
    draftRef.current = tag;
    setDraft(tag);
  }, [tag]);

  assert(tag.length <= LIMITS.tagNameCharsMax, 'TagField: tag limit exceeded');
  assert((options?.length ?? 0) <= LIMITS.scanEntriesMax, 'TagField: option limit exceeded');
  const pool = options && options.length ? options : HTML_TAGS.map((name) => ({ name, kind: 'element' }));
  const query = draft.trim();
  const ql = query.toLowerCase();
  const matches =
    focused && query && query !== tag
      ? pool
          .filter((option) => option.name.toLowerCase().includes(ql))
          .sort((left, right) => {
            const ap = left.name.toLowerCase().startsWith(ql) ? 0 : 1;
            const bp = right.name.toLowerCase().startsWith(ql) ? 0 : 1;
            return ap - bp || left.name.length - right.name.length;
          })
          .slice(0, 12)
      : [];

  useLayoutEffect(() => {
    if (!matches.length || !wrapRef.current) {
      setPopupPosition(undefined);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    setPopupPosition({ left: rect.left, top: rect.bottom + 4, width: rect.width });
  }, [matches.length, draft]);

  return {
    draft,
    setFocused,
    highlight,
    setHighlight,
    popupPos: popupPosition,
    wrapRef,
    inputRef,
    committedRef,
    draftRef,
    updateDraft,
    matches,
  };
}
function useTagField(props: TagFieldProps) {
  const { tag, onChangeTag } = props;
  const model = useTagModel(props);
  const {
    highlight,
    setHighlight,

    inputRef,
    committedRef,
    draftRef,
    updateDraft,
    matches,
  } = model;
  const apply = (name: string) => {
    committedRef.current = name;
    updateDraft(name);
    const revert = () => {
      committedRef.current = tag;
      updateDraft(tag);
    };
    Promise.resolve(onChangeTag(name)).then(
      (ok) => {
        if (ok === false) {
          revert();
        }
      },
      (error: unknown) => {
        console.error('Tag field: rename failed', error);
        revert();
      },
    );
  };

  const commit = (text: string) => {
    const raw = String(text).trim();
    if (raw.length > LIMITS.tagNameCharsMax) {
      return updateDraft(committedRef.current);
    }
    if (raw === committedRef.current) {
      return updateDraft(committedRef.current);
    }
    if (/^[A-Z][\w$]*$/.test(raw)) {
      return apply(raw);
    }
    const clean = raw.toLowerCase();
    if (/^[a-z][a-z0-9-]*$/.test(clean) && clean !== committedRef.current && clean !== 'slot') {
      apply(clean);
    } else {
      updateDraft(committedRef.current);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && matches.length) {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp' && matches.length) {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' || (event.key === 'Tab' && matches.length)) {
      event.preventDefault();
      const picked = matches[Math.min(highlight, matches.length - 1)];
      commit(picked ? picked.name : draftRef.current);
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      updateDraft(committedRef.current);
      inputRef.current?.blur();
    }
  };

  return { ...model, commit, onKeyDown };
}

export function TagField(props: TagFieldProps) {
  const state = useTagField(props);
  return <TagFieldView state={state} />;
}

function TagFieldView({ state }: { readonly state: ReturnType<typeof useTagField> }) {
  const translate = useTranslate();
  const { draft, setFocused, highlight, setHighlight, popupPos: popupPosition, wrapRef, inputRef, draftRef, updateDraft, matches, commit, onKeyDown } = state;
  return (
    <div className="props-field" ref={wrapRef}>
      <label onClick={noLabelActivation}>
        <span className="prop-label">
          <TagIcon size={12} className="prop-label-icon" />
          {translate('props.map.tag')}
        </span>
      </label>
      <input
        maxLength={LIMITS.tagNameCharsMax}
        ref={inputRef}
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          updateDraft(event.target.value);
          setHighlight(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(draftRef.current);
        }}
        onKeyDown={onKeyDown}
      />
      {popupPosition && (
        <Popup
          mode="popover"
          portal={false}
          onClose={() => setFocused(false)}
          className="dd-popup class-suggest"
          style={{ left: popupPosition.left, top: popupPosition.top, width: popupPosition.width }}
        >
          {matches.map((option, i) => (
            <div
              key={option.name}
              className={`dd-option ${i === highlight ? 'highlight' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                commit(option.name);
                inputRef.current?.blur();
              }}
            >
              <span className="dd-option-icon">{tagOptionIcon(option)}</span>
              <span className="dd-option-label">{option.name}</span>
            </div>
          ))}
        </Popup>
      )}
    </div>
  );
}

function MapListSettings({ props, children }: { readonly props: MapEditorProps; readonly children: React.ReactNode }) {
  const { node, dataContext, imports, projectPath, onSetLoopSource, bindContext, loopContext } = props;
  const data = parseMapHead(node.head)?.data ?? '';
  const frontmatter = dataContext?.frontmatter ?? '';
  const input = useMemo<Omit<LoopReadInput, 'fieldKind'>>(() => ({ frontmatter, imports: imports ?? [], data }), [frontmatter, imports, data]);
  const context = bindContext || loopContext;
  const tree = useMemo(() => dataTree(context || {}), [context]);
  const lists = useMemo(() => pageLists(tree), [tree]);
  const pickerData = useMemo<SourcePickerData>(
    () => ({
      tree,
      samples: context?.collectionSamples ?? {},
      onNeedSample: context?.onNeedSample,
      onStepItem: context?.onStepItem,
      frontmatter,
      file: dataContext?.filePath,
      projectModules: context?.projectModules,
    }),
    [tree, context, frontmatter, dataContext?.filePath],
  );
  if (onSetLoopSource === undefined) {
    return children;
  }
  return (
    <LoopSettings
      input={input}
      item={parseMapHead(node.head)?.item}
      projectPath={projectPath}
      filePath={dataContext?.filePath}
      lists={lists}
      pickerData={pickerData}
      newProp={context?.newProp}
      onApply={onSetLoopSource}
      onEditProperty={props.onEditLoopProperty}
      sourceButton={(name, anchorRef) => <SourceEditButton name={name} dataContext={dataContext} anchorRef={anchorRef} />}
    >
      {children}
    </LoopSettings>
  );
}

const PAGE_LISTS_MAX = 100;

export function pageLists(tree: readonly TreeNode[]): readonly LoopListOption[] {
  const out: LoopListOption[] = [];
  const pending: TreeNode[] = [...listsOnly(tree)].reverse();
  for (let count = 0; pending.length > 0 && out.length < PAGE_LISTS_MAX && count < LIMITS.treeNodesMax; count++) {
    const node = pending.pop();
    if (node === undefined || node.section === 'collections' || node.query !== undefined) {
      continue;
    }
    if ('pickable' in node && node.pickable === true) {
      out.push({ path: node.path, label: node.path, hint: node.preview || '' });
    }
    for (const child of [...(node.children ?? [])].reverse()) {
      pending.push(child);
    }
  }
  return out;
}
