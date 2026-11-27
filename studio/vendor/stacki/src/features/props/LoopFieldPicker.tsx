
import { useCallback, useState } from 'react';
import type { ReactNode, RefCallback } from 'react';
import DataPicker, { type PickerNode } from './DataPicker';
import { ChevronDownIcon, PlusIcon } from '../../ui/Icons';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { sampleAt, samplePreview } from '../../editor/dataSample';
import type { CatalogField } from './loopCatalog';
import { fieldIcon, RowPopup } from './LoopRows';
import { TypedFieldForm, type TypedFieldSupport } from './LoopTypedFieldForm';
import { useTranslate } from '../../lib/i18n/useTranslate';

const PICKER_HEIGHT_PX_MAX = 420;
const PICKER_WIDTH_PX_MIN = 300;

export interface FieldExtra {
  readonly value: string;
  readonly label: string;
  readonly icon: ReactNode;
}

export function FieldPicker(props: {
  readonly value: string;
  readonly fields: readonly CatalogField[];
  readonly usable: (field: CatalogField) => boolean;
  readonly sample: unknown;
  readonly extras: readonly FieldExtra[];
  readonly typed?: TypedFieldSupport | undefined;
  readonly onChange: (value: string, typed?: CatalogField) => void;
}) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | undefined>(undefined);
  const attach = useCallback<RefCallback<HTMLButtonElement>>((element) => setAnchor(element ?? undefined), []);
  const choose = (value: string, typed?: CatalogField): void => {
    setOpen(false);
    props.onChange(value, typed);
  };
  const field = props.fields.find((candidate) => candidate.path === props.value);
  const extra = props.extras.find((candidate) => candidate.value === props.value);
  return (
    <>
      <button
        ref={attach}
        type="button"
        className="dd-trigger loop-source-trigger"
        aria-label={translate('props.loop.field')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="dd-icon">{extra?.icon ?? (field === undefined ? undefined : fieldIcon(field.kind))}</span>
        <span className="dd-label">{extra?.label ?? field?.title ?? props.value}</span>
        <span className="dd-chevron">
          <ChevronDownIcon size={11} />
        </span>
      </button>
      {open && (
        <RowPopup
          anchor={anchor}
          heightPxMax={PICKER_HEIGHT_PX_MAX}
          widthPxMin={PICKER_WIDTH_PX_MIN}
          label={translate('props.loop.field')}
          onClose={() => setOpen(false)}
        >
          <div className="loop-source-picker">
            {}
            <DataPicker
              tree={fieldTree(props.fields, props.sample, props.usable)}
              current={field?.path}
              footer={false}
              onPick={(path) => {
                if (props.fields.some((candidate) => candidate.path === path && props.usable(candidate))) {
                  choose(path);
                }
              }}
            />
            {(props.extras.length > 0 || props.typed !== undefined) && (
              <div className="loop-field-extras">
                {props.extras.map((candidate) => (
                  <button key={candidate.value} type="button" className="dp-row" onClick={() => choose(candidate.value)}>
                    {candidate.icon}
                    <span className="dp-key">{candidate.label}</span>
                  </button>
                ))}
                {props.typed !== undefined &&
                  (typing ? (
                    <TypedFieldForm item={props.typed.item} onUse={(typed) => choose(typed.path, typed)} />
                  ) : (
                    <button type="button" className="dp-row" onClick={() => setTyping(true)}>
                      <PlusIcon size={13} />
                      <span className="dp-key">{translate('props.loop.typed.open')}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </RowPopup>
      )}
    </>
  );
}

export function fieldTree(fields: readonly CatalogField[], sample: unknown, usable: (field: CatalogField) => boolean): readonly PickerNode[] {
  assert(fields.length <= LIMITS.treeNodesMax, 'A field tree is bounded');
  interface Building {
    readonly path: string;
    readonly key: string;
    readonly field: CatalogField | undefined;
    readonly children: Building[];
  }
  const roots: Building[] = [];
  const byPath = new Map<string, Building>();
  const fieldsByPath = new Map(fields.map((field) => [field.path, field]));
  for (const field of fields) {
    const segments = field.path.split('.');
    assert(segments.length <= LIMITS.treeDepthMax, 'A field path is shallow');
    let siblings = roots;
    for (let index = 0; index < segments.length; index++) {
      const path = segments.slice(0, index + 1).join('.');
      let node = byPath.get(path);
      if (node === undefined) {
        node = { path, key: segments[index] ?? path, field: fieldsByPath.get(path), children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  const finish = (node: Building, depth: number): PickerNode => {
    assert(depth <= LIMITS.treeDepthMax, 'A field tree is shallow');
    const field = node.field;
    const value = sampleAt(sample, node.path);
    const children = node.children.map((child) => finish(child, depth + 1));
    return {
      path: node.path,
      key: field === undefined ? node.key : (field.title.split(' › ').pop() ?? field.title),
      kind: field?.kind ?? 'object',
      preview: value === undefined ? '' : samplePreview(value),
      children: children.length > 0 ? children : undefined,
      pickable: field !== undefined && usable(field),
    };
  };
  return roots.map((root) => finish(root, 0));
}
