
import PropTip from './PropTip';
import { ErrorToast } from '../../ui/ErrorToast';
import { useCallback, useLayoutEffect, useState } from 'react';
import type { ReactNode, RefCallback } from 'react';
import Popup from '../../ui/Popup';
import ExprInput from '../../ui/ExprInput';
import { ResetLabel } from '../../ui/ResetLabel';
import { dataPickerPosition, popupHeightPxMax } from './dataPickerPosition';
import type { FieldPosition } from './bindingTypes';
import {
  AssetManagerIcon,
  CalendarIcon,
  CollectionIcon,
  FieldNumberIcon,
  FieldSwitchIcon,
  LayersIcon,
  PaperclipIcon,
  PlusIcon,
  TextIcon,
  TrashIcon,
  ChevronRightIcon,
  DragIcon,
} from '../../ui/Icons';
import { type LoopFieldKind } from '../../editor/loopQuery';
import { type RowParts } from './loopSettingsModel';
import { useLocale, useTranslate } from '../../lib/i18n/useTranslate';
export function ListRow(props: {
  readonly parts: RowParts;
  readonly open: boolean;
  readonly locked?: boolean;
  readonly dragThrough?: boolean;
  readonly removeLabel: string;
  readonly editor?: ReactNode;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
}) {
  const translate = useTranslate();
  const { parts } = props;
  const [row, setRow] = useState<HTMLDivElement | undefined>(undefined);
  const attach = useCallback<RefCallback<HTMLDivElement>>((element) => setRow(element ?? undefined), []);
  return (
    <div ref={attach} className={`loop-settings-item${props.open ? ' open' : ''}`}>
      {}
      {props.dragThrough === true && (
        <span className="loop-settings-item-grip" aria-hidden="true">
          <DragIcon size={12} />
        </span>
      )}
      <button
        type="button"
        className="loop-settings-item-main"
        data-drag-through={props.dragThrough === true ? '' : undefined}
        title={`${parts.lead} ${parts.rest}`}
        disabled={props.locked === true}
        aria-expanded={props.open}
        aria-haspopup="dialog"
        onClick={props.onToggle}
      >
        <span className="loop-settings-item-lead">{parts.lead}</span>
        <span className="loop-settings-item-rest">{parts.rest}</span>
      </button>
      <button type="button" className="loop-settings-item-remove" aria-label={props.removeLabel} title={translate('ui.remove')} onClick={props.onRemove}>
        <TrashIcon size={13} />
      </button>
      {props.open && props.editor !== undefined && (
        <RowPopup anchor={row} onClose={props.onToggle}>
          {props.editor}
        </RowPopup>
      )}
    </div>
  );
}

const ROW_POPUP_HEIGHT_PX_MAX = 220;

export function RowPopup(props: {
  readonly anchor: HTMLElement | undefined;
  readonly heightPxMax?: number;
  readonly widthPxMin?: number;
  readonly label?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const translate = useTranslate();
  const [placed, setPlaced] = useState<{ readonly anchor: HTMLElement; readonly position: FieldPosition & { readonly maxHeight: number } } | undefined>(
    undefined,
  );
  const { anchor } = props;
  const heightPxMax = props.heightPxMax ?? ROW_POPUP_HEIGHT_PX_MAX;
  const { widthPxMin } = props;
  useLayoutEffect(() => {
    if (anchor === undefined) {
      return undefined;
    }
    const place = (): void => {
      const rectangle = anchor.getBoundingClientRect();
      const position = dataPickerPosition(rectangle, widthPxMin === undefined ? { heightPxMax } : { heightPxMax, widthPxMin });
      setPlaced({ anchor, position: { ...position, maxHeight: popupHeightPxMax(position.top, heightPxMax) } });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, heightPxMax, widthPxMin]);
  if (placed === undefined) {
    return undefined;
  }
  return (
    <Popup
      mode="popover"
      portal={true}
      anchor={placed.anchor}
      onClose={props.onClose}
      className="loop-settings-popup"
      style={placed.position}
      role="dialog"
      label={props.label ?? translate('props.loop.rows.edit')}
    >
      {props.children}
    </Popup>
  );
}

export interface SectionReset {
  readonly applied: boolean;
  readonly onReset: () => void;
}

export function AppliedLabel(props: { readonly title: string; readonly reset: SectionReset }) {
  return <ResetLabel label={props.title} active={props.reset.applied} onReset={props.reset.onReset} />;
}

export function SectionHeader(props: {
  readonly title: string;
  readonly addable: boolean;
  readonly extra?: ReactNode;
  readonly dot?: ReactNode;
  readonly label?: ReactNode;
  readonly toggle?: ReactNode;
  readonly reset?: SectionReset;
  readonly onAdd: () => void;
}) {
  const translate = useTranslate();
  const { locale } = useLocale();
  const addLabel = translate('props.loop.rows.add', { title: locale === 'de' ? props.title : props.title.toLowerCase() });
  return (
    <div className="loop-settings-header">
      <span className="loop-settings-label">
        {props.label ??
          (props.reset === undefined ? <span className="prop-label">{props.title}</span> : <AppliedLabel title={props.title} reset={props.reset} />)}
        {props.dot}
        {props.toggle}
      </span>
      <span className="loop-settings-header-tools">{props.extra}</span>
      <button type="button" className="loop-settings-add" aria-label={addLabel} title={addLabel} disabled={!props.addable} onClick={props.onAdd}>
        <PlusIcon size={13} />
      </button>
    </div>
  );
}

export function fieldIcon(kind: LoopFieldKind): ReactNode {
  switch (kind) {
    case 'text':
      return <TextIcon size={13} />;
    case 'number':
      return <FieldNumberIcon size={13} />;
    case 'boolean':
      return <FieldSwitchIcon size={13} />;
    case 'date':
      return <CalendarIcon size={13} />;
    case 'list':
      return <LayersIcon size={13} />;
    case 'reference':
      return <PaperclipIcon size={13} />;
    case 'image':
      return <AssetManagerIcon size={13} />;
    case 'other':
      return <CollectionIcon size={13} />;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function CodeBox(props: {
  readonly value: string;
  readonly label: string;
  readonly placeholder: string;
  readonly check: (code: string) => string | undefined;
  readonly onCommit: (code: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const commit = (text: string): void => {
    const code = text.trim();
    if (code === props.value.trim()) {
      setProblem(undefined);
      return;
    }
    const found = props.check(code);
    setProblem(found);
    if (found === undefined) {
      props.onCommit(code);
    }
  };
  return (
    <div
      className="loop-settings-code"
      role="group"
      aria-label={props.label}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          commit(draft);
        }
      }}
    >
      <ExprInput
        value={draft}
        placeholder={props.placeholder}
        invalid={problem !== undefined}
        multiline={true}
        wrap={true}
        onChange={setDraft}
        onCommit={commit}
      />
      <ErrorToast message={problem} />
    </div>
  );
}

export function EditorRow(props: { readonly label: string; readonly dot?: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="loop-settings-editor-row">
      <span className="loop-settings-editor-label loop-settings-label">{props.label}</span>
      {}
      <div className="loop-settings-editor-control">
        {props.children}
        {props.dot}
      </div>
    </div>
  );
}

export function LoopDetailsTip(props: { readonly text: string }) {
  const translate = useTranslate();
  return (
    <div className="loop-lineage">
      <div className="loop-lineage-toggle">
        {translate('props.loop.rows.details')}
        <PropTip text={props.text} />
      </div>
    </div>
  );
}

export function LoopDetails(props: { readonly children: ReactNode }) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  return (
    <div className="loop-lineage">
      <button type="button" className="loop-lineage-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {translate('props.loop.rows.details')}
        <ChevronRightIcon size={10} className={`loop-lineage-chevron${open ? ' open' : ''}`} />
      </button>
      {open && <div className="loop-lineage-body">{props.children}</div>}
    </div>
  );
}
