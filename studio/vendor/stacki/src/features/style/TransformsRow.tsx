import { centralIcon } from '../../ui/central/CentralIcon';
import { add as centralAdd, code as centralCode, filter as centralFilter, more as centralMore } from '../../ui/central/centralGeometry';
import { CodeBlock, CodeInline } from '../../ui/CodeBlock';
import type { RawLayer } from './model/rawLayer';

import { useEffect, useRef, useState } from 'react';
import { parseHideable, serializeHideable, type Hideable } from './model/hideable';
import TransformSettings from './TransformSettings';
import { takeSelfPerspective, withSelfPerspective } from './model/transformSettings';
import DragSlider from './components/DragSlider';
import SegmentedControl, { type SegmentedOption } from '../../ui/SegmentedControl';
import useScrub from './components/useScrub';
import LayerList from './LayerList';
import LayerPopover from './LayerPopover';
import VariableConnect from './VariableConnect';
import {
  parseTransforms,
  serializeTransforms,
  blankTransform,
  retypeTransform,
  transformLabel,
  hasZ,
  IDENTITY,
  type Transform,
  type TransformLayer,
  type TransformPatch,
  type TransformType,
} from './model/transform';
import { transformAxisIcon, transformTypeIcon, LockIcon, UnlockIcon } from './transformIcons';
import { parseFilters, serializeFilters, blankFilter, filterLabel, type FilterLayer } from './model/filter';
import FilterEditor from './FilterFields';
import { useExternalDraft } from './model/fieldHooks';
import { displayOf } from './model/styleDisplay';
import { useLengthUnit } from './model/lengthUnit';
import { projectLength, type LengthUnit } from '../../../shared/properties/lengthUnit';
import { type Props, type WriteOptions, useLiveTimer, draftInputHandlers, writeValue, useLayerRows, EffLabel } from './EffectsKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';


export const transformTypes = (translate: Translator): ReadonlyArray<SegmentedOption<TransformType>> => [
  { value: 'move', label: translate('style.transformsRow.move') },
  { value: 'scale', label: translate('style.transformsRow.scale') },
  { value: 'rotate', label: translate('style.transformsRow.rotate') },
  { value: 'skew', label: translate('style.transformsRow.skew') },
];

export const MoreIcon = centralIcon(centralMore);
export const TransformPlusIcon = centralIcon(centralAdd);

export const FilterGlyph = centralIcon(centralFilter);
const RawGlyph = centralIcon(centralCode);

const rawRow = (layer: RawLayer) => ({ preview: <RawGlyph />, label: <CodeInline text={layer.text} language="css" /> });
const RawLayerView = ({ layer }: { readonly layer: RawLayer }) => (
  <div className="embed-editor_type-shadow-editor">
    <CodeBlock text={layer.text} language="css" className="embed-editor_raw-layer" />
  </div>
);

export function FiltersRow({ prop, label, props }: { prop: string; label: string; props: Props }) {
  const { read, busy } = props;
  const translate = useTranslate();
  const display = displayOf(read(prop));
  const rows = parseHideable(display.present ? display.value : '', ' ', parseFilters);
  const layers = rows.map((row) => row.item);
  const write = (next: Array<Hideable<FilterLayer>>, options: WriteOptions) => writeValue(prop, serializeHideable(next, ' ', serializeFilters), options, props);
  const stack = useLayerRows<FilterLayer>({ rows, blank: blankFilter, write });
  const { openIndex } = stack;
  const openLayer = openIndex === undefined ? undefined : layers[openIndex];
  return (
    <div className="embed-editor_type-shadows">
      <div className="embed-editor_bg-layers-head">
        <EffLabel label={label} prop={prop} props={props} />
        <button
          type="button"
          className="embed-editor_icon-btn"
          onClick={stack.add}
          disabled={busy}
          title={prop === 'backdrop-filter' ? translate('style.transformsRow.addBackdropFilter') : translate('style.transformsRow.addFilter')}
          aria-label={translate('style.transformsRow.addFilter')}
        >
          <TransformPlusIcon />
        </button>
      </div>
      <LayerList
        count={layers.length}
        busy={busy}
        ariaLabel={label}
        onOpen={stack.open}
        onReorder={stack.reorder}
        onRemove={stack.remove}
        isHidden={stack.isHidden}
        onToggleHidden={stack.toggle}
        renderRow={(i) => {
          const layer = layers[i];
          if (layer === undefined) {
            throw new Error(`Filter layer ${i} is missing`);
          }
          return layer.type === 'raw' ? rawRow(layer) : { preview: <FilterGlyph />, label: filterLabel(layer, translate) };
        }}
      />
      {openIndex !== undefined && stack.anchorElement && openLayer ? (
        <LayerPopover anchorEl={stack.anchorElement} ariaLabel={label} onClose={stack.close}>
          {openLayer.type === 'raw' ? (
            <RawLayerView layer={openLayer} />
          ) : (
            <FilterEditor filter={openLayer} busy={busy} onChange={(next, live) => stack.update(openIndex, { live }, () => next)} />
          )}
        </LayerPopover>
      ) : undefined}
    </div>
  );
}

export const AXIS_CONFIG: Record<TransformType, { unit: string; min: number; max: number; steps: number }> = {
  move: { unit: 'rem', min: -20, max: 20, steps: 100 },
  scale: { unit: '', min: 0, max: 2, steps: 100 },
  rotate: { unit: 'deg', min: -180, max: 180, steps: 1 },
  skew: { unit: 'deg', min: -90, max: 90, steps: 1 },
};

export function projectAxisConfig(type: TransformType, lengthUnit: LengthUnit): { unit: string; min: number; max: number; steps: number } {
  const config = AXIS_CONFIG[type];
  if (lengthUnit.kind === 'rem' && config.unit === 'rem') {
    return { ...config, steps: lengthUnit.rootFontPx };
  }
  return config;
}

export function projectAxis(parsed: { num: number; unit: string } | undefined, lengthUnit: LengthUnit): { num: number; unit: string } | undefined {
  if (parsed === undefined) {
    return undefined;
  }
  const written = projectLength(parsed.num, parsed.unit, lengthUnit);
  return { num: written.amount, unit: written.unit };
}

export function parseAxis(value: string, fallbackUnit: string): { num: number; unit: string } | undefined {
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  if (!match) {
    return undefined;
  }
  const unit = match[2] ?? '';
  const raw = unit.toLowerCase() === 'none' ? '' : unit;
  return { num: parseFloat(match[1] ?? ''), unit: raw || fallbackUnit };
}

export interface AxisInputProps {
  type: TransformType;
  label: 'X' | 'Y' | 'Z';
  value: string;
  placeholder: string;
  busy: boolean;
  onPreview?: (value: string) => void;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
}
export function AxisInput(props: AxisInputProps) {
  const { type, label, value, placeholder, busy, onPreview, onLive, onCommit } = props;
  const translate = useTranslate();
  const lengthUnit = useLengthUnit();
  const config = projectAxisConfig(type, lengthUnit);
  const parsed = projectAxis(parseAxis(value, config.unit), lengthUnit);
  const unit = parsed?.unit ?? config.unit;
  const fmt = (slider: number): string => `${Number((slider / config.steps).toFixed(4))}${unit}`;
  const { draft, setDraft, focused } = useExternalDraft(value);
  const field = useAxisField({
    draft,
    setDraft,
    focused,
    placeholder,
    busy,
    onPreview,
    onLive,
    onCommit,
  });
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption embed-editor_transform-axis" aria-hidden="true">
        {transformAxisIcon(type, label === 'X' ? 'x' : label === 'Y' ? 'y' : 'z')}
      </span>
      <div className="embed-editor_shadow-field">
        <DragSlider
          value={Math.round((parsed?.num ?? 0) * config.steps)}
          min={config.min * config.steps}
          max={config.max * config.steps}
          disabled={busy || !parsed}
          ariaLabel={label}
          onPreview={(slider) => {
            const formatted = fmt(slider);
            if (!focused.current) {
              setDraft(formatted);
            }
            onPreview?.(formatted);
          }}
          onInput={(slider) => onLive(fmt(slider))}
          onCommit={(slider) => onCommit(fmt(slider))}
        />
        {}
        <VariableConnect
          code
          ariaLabel={translate('style.transformsRow.connect', { name: label })}
          disabled={busy}
          className="is-fill"
          prop="transform"
          onPick={(binding) => onCommit(binding)}
        >
          <input
            {...field.scrub.input}
            className="u-input embed-editor_size-input embed-editor_shadow-num"
            value={draft}
            {...field.handlers}
            disabled={busy}
            spellCheck={false}
            placeholder={placeholder}
            aria-label={label}
          />
        </VariableConnect>
      </div>
    </div>
  );
}

export function useAxisField({
  draft,
  setDraft,
  focused,
  placeholder,
  busy,
  onPreview,
  onLive,
  onCommit,
}: {
  draft: string;
  setDraft: (draft: string) => void;
  focused: React.MutableRefObject<boolean>;
  placeholder: string;
  busy: boolean;
  onPreview: ((value: string) => void) | undefined;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const liveNow = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) {
      onLive(trimmed);
    }
  };
  const { live, cancel } = useLiveTimer(liveNow);
  const commit = (text = draft) => {
    onCommit(text.trim() || placeholder);
  };
  const previewScrub = (text: string) => {
    setDraft(text);
    onPreview?.(text);
  };
  const commitScrub = (text: string) => {
    setDraft(text);
    commit(text);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: previewScrub,
    onInput: liveNow,
    onCommit: commitScrub,
  });
  const handlers = draftInputHandlers({ focusedRef: focused, setDraft, live, cancel, commit });
  return { scrub, handlers };
}

export function TransformEditor({ layer, busy, onChange }: { layer: Transform; busy: boolean; onChange: (patch: TransformPatch, live: boolean) => void }) {
  const translate = useTranslate();
  const placeholder = IDENTITY[layer.type];
  const [locked, setLocked] = useState(true);
  const linkXY = layer.type === 'scale' && locked;
  const { values, bump } = useAxisValues(layer);
  const emit = (patch: TransformPatch, options: WriteOptions) => {
    bump(patch);
    onChange(patch, options.live);
  };
  const handlersFor = (patchOf: (value: string) => TransformPatch) => ({
    onPreview: (value: string) => bump(patchOf(value)),
    onLive: (value: string) => emit(patchOf(value), { live: true }),
    onCommit: (value: string) => emit(patchOf(value), { live: false }),
  });
  const axes = axisFields({ values, linkXY, handlersFor });
  const retype = (type: TransformType) => emit(retypeTransform(type), { live: false });
  const shared = { placeholder, busy };
  return (
    <div className="embed-editor_type-shadow-editor">
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.transformsRow.type')}</span>
        <SegmentedControl value={layer.type} options={transformTypes(translate)} onChange={retype} ariaLabel={translate('style.transformsRow.transformType')} />
      </div>
      {layer.type === 'scale' ? (
        <div className="embed-editor_transform-lock-group">
          <div className="embed-editor_transform-lock-rows">
            <AxisInput type="scale" label="X" {...shared} {...axes.x} />
            <AxisInput type="scale" label="Y" {...shared} {...axes.y} />
          </div>
          <ScaleLock locked={locked} busy={busy} onToggle={() => setLocked((wasLocked) => !wasLocked)} />
        </div>
      ) : (
        <>
          <AxisInput type={layer.type} label="X" {...shared} {...axes.x} />
          <AxisInput type={layer.type} label="Y" {...shared} {...axes.y} />
        </>
      )}
      {!hasZ(layer.type) ? undefined : layer.type === 'scale' ? (
        <div className="embed-editor_transform-lock-group">
          <div className="embed-editor_transform-lock-rows">
            <AxisInput type="scale" label="Z" {...shared} {...axes.z} />
          </div>
          <span className="embed-editor_transform-lock-spacer" aria-hidden="true" />
        </div>
      ) : (
        <AxisInput type={layer.type} label="Z" {...shared} {...axes.z} />
      )}
    </div>
  );
}

export function axisFields({
  values,
  linkXY,
  handlersFor,
}: {
  values: { x: string; y: string; z: string };
  linkXY: boolean;
  handlersFor: (patchOf: (value: string) => TransformPatch) => Omit<AxisField, 'value'>;
}): AxisFields {
  const xPatch = (value: string): TransformPatch => (linkXY ? { x: value, y: value } : { x: value });
  const yPatch = (value: string): TransformPatch => (linkXY ? { x: value, y: value } : { y: value });
  return {
    x: { value: values.x, ...handlersFor(xPatch) },
    y: { value: values.y, ...handlersFor(yPatch) },
    z: { value: values.z, ...handlersFor((value) => ({ z: value })) },
  };
}

export interface AxisField {
  value: string;
  onPreview: (value: string) => void;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
}
export type AxisFields = Record<'x' | 'y' | 'z', AxisField>;

export function useAxisValues(layer: Transform) {
  const [values, setValues] = useState<{ x: string; y: string; z: string }>({
    x: layer.x,
    y: layer.y,
    z: layer.z,
  });
  useEffect(() => {
    setValues({ x: layer.x, y: layer.y, z: layer.z });
  }, [layer.x, layer.y, layer.z]);
  const bump = (patch: TransformPatch) =>
    setValues((current) => {
      const next = { ...current, ...patch };
      return { x: next.x, y: next.y, z: next.z };
    });
  return { values, bump };
}

export function ScaleLock({ locked, busy, onToggle }: { locked: boolean; busy: boolean; onToggle: () => void }) {
  const translate = useTranslate();
  return (
    <button
      type="button"
      className={`embed-editor_transform-lock ${locked ? 'is-locked' : ''}`}
      onClick={onToggle}
      disabled={busy}
      aria-pressed={locked}
      title={locked ? translate('style.transformsRow.unlinkXY') : translate('style.transformsRow.linkXY')}
      aria-label={locked ? translate('style.transformsRow.unlinkXYAria') : translate('style.transformsRow.linkXYAria')}
    >
      {locked ? <LockIcon /> : <UnlockIcon />}
    </button>
  );
}

export function TransformsRow({ props }: { props: Props }) {
  const { read, busy, setProp, clearProp } = props;
  const translate = useTranslate();
  const display = displayOf(read('transform'));
  const { distance: selfPerspective, rest } = takeSelfPerspective(display.present ? display.value : '');
  const rows = parseHideable(rest, ' ', parseTransforms);
  const layers = rows.map((row) => row.item);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const put = (next: Array<Hideable<TransformLayer>>, distance: string, options: WriteOptions) => {
    const value = withSelfPerspective(serializeHideable(next, ' ', serializeTransforms), distance);
    writeValue('transform', value, options, props);
  };
  const write = (next: Array<Hideable<TransformLayer>>, options: WriteOptions) => put(next, selfPerspective, options);
  const stack = useLayerRows<TransformLayer>({ rows, blank: blankTransform, write });
  const { openIndex } = stack;
  const openLayer = openIndex === undefined ? undefined : layers[openIndex];
  return (
    <div className="embed-editor_type-shadows">
      <TransformsHead
        props={props}
        settingsOpen={settingsOpen}
        settingsRef={settingsRef}
        onToggleSettings={() => setSettingsOpen((wasOpen) => !wasOpen)}
        onAdd={stack.add}
      />
      <LayerList
        count={layers.length}
        busy={busy}
        ariaLabel={translate('style.transformsRow.transforms')}
        onOpen={stack.open}
        onReorder={stack.reorder}
        onRemove={stack.remove}
        isHidden={stack.isHidden}
        onToggleHidden={stack.toggle}
        renderRow={(i) => transformRow(layers, i, translate)}
      />
      {openIndex !== undefined && stack.anchorElement && openLayer ? (
        <LayerPopover anchorEl={stack.anchorElement} ariaLabel={translate('style.transformsRow.transform')} onClose={stack.close}>
          {openLayer.type === 'raw' ? (
            <RawLayerView layer={openLayer} />
          ) : (
            <TransformEditor
              layer={openLayer}
              busy={busy}
              onChange={(patch, live) => stack.update(openIndex, { live }, (item) => (item.type === 'raw' ? item : { ...item, ...patch }))}
            />
          )}
        </LayerPopover>
      ) : undefined}
      {settingsOpen && settingsRef.current ? (
        <LayerPopover anchorEl={settingsRef.current} ariaLabel={translate('style.transformsRow.transformSettings')} onClose={() => setSettingsOpen(false)}>
          <TransformSettings
            read={read}
            busy={busy}
            setProp={setProp}
            clearProp={clearProp}
            selfPerspective={selfPerspective}
            onSelfPerspective={(distance, live) => put(rows, distance, { live })}
          />
        </LayerPopover>
      ) : undefined}
    </div>
  );
}

export function transformRow(layers: readonly TransformLayer[], i: number, translate: Translator) {
  const layer = layers[i];
  if (layer === undefined) {
    throw new Error(`Transform layer ${i} is missing`);
  }
  return layer.type === 'raw' ? rawRow(layer) : { preview: transformTypeIcon(layer.type), label: transformLabel(layer, translate) };
}

export function TransformsHead({
  props,
  settingsOpen,
  settingsRef,
  onToggleSettings,
  onAdd,
}: {
  props: Props;
  settingsOpen: boolean;
  settingsRef: React.RefObject<HTMLButtonElement>;
  onToggleSettings: () => void;
  onAdd: () => void;
}) {
  const { busy } = props;
  const translate = useTranslate();
  return (
    <div className="embed-editor_bg-layers-head">
      <EffLabel label={translate('style.transformsRow.transforms2d3d')} prop="transform" props={props} />
      <div className="embed-editor_bg-layers-actions">
        <button
          type="button"
          ref={settingsRef}
          className={`embed-editor_icon-btn ${settingsOpen ? 'is-active' : ''}`}
          onClick={onToggleSettings}
          disabled={busy}
          title={translate('style.transformsRow.transformSettings')}
          aria-label={translate('style.transformsRow.transformSettings')}
          aria-expanded={settingsOpen}
        >
          <MoreIcon />
        </button>
        <button
          type="button"
          className="embed-editor_icon-btn"
          onClick={onAdd}
          disabled={busy}
          title={translate('style.transformsRow.addTransform')}
          aria-label={translate('style.transformsRow.addTransform')}
        >
          <TransformPlusIcon />
        </button>
      </div>
    </div>
  );
}
