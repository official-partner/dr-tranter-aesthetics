
import { parseHideable, serializeHideable, type Hideable } from './model/hideable';
import SegmentedControl, { type SegmentedOption } from '../../ui/SegmentedControl';
import LayerList from './LayerList';
import LayerPopover from './LayerPopover';
import { ShadowLength, ShadowColorRow } from './ShadowFields';
import { parseBoxShadows, serializeBoxShadows, blankBoxShadow, boxShadowLabel, type BoxShadow, type BoxShadowPatch } from './model/boxShadow';
import { PlusIcon } from './components/MenuParts';
import { displayOf } from './model/styleDisplay';
import { type Props, type WriteOptions, writeValue, useLayerRows, EffLabel } from './EffectsKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';


export const boxShadowTypes = (translate: Translator): ReadonlyArray<SegmentedOption<string>> => [
  { value: 'outset', label: translate('style.boxShadowsRow.outside') },
  { value: 'inset', label: translate('style.boxShadowsRow.inside') },
];

export function BoxShadowEditor({ shadow, busy, onChange }: { shadow: BoxShadow; busy: boolean; onChange: (patch: BoxShadowPatch, live: boolean) => void }) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_type-shadow-editor">
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.boxShadowsRow.type')}</span>
        <SegmentedControl
          value={shadow.inset ? 'inset' : 'outset'}
          options={boxShadowTypes(translate)}
          onChange={(next) => onChange({ inset: next === 'inset' }, false)}
          ariaLabel={translate('style.boxShadowsRow.shadowType')}
          disabled={busy}
        />
      </div>
      <ShadowLength label="X" value={shadow.x} busy={busy} onCommit={(next) => onChange({ x: next }, false)} onLive={(next) => onChange({ x: next }, true)} />
      <ShadowLength label="Y" value={shadow.y} busy={busy} onCommit={(next) => onChange({ y: next }, false)} onLive={(next) => onChange({ y: next }, true)} />
      <ShadowLength
        label={translate('style.boxShadowsRow.blur')}
        value={shadow.blur}
        busy={busy}
        onCommit={(next) => onChange({ blur: next }, false)}
        onLive={(next) => onChange({ blur: next }, true)}
      />
      <ShadowLength
        label={translate('style.boxShadowsRow.size')}
        value={shadow.spread}
        busy={busy}
        onCommit={(next) => onChange({ spread: next }, false)}
        onLive={(next) => onChange({ spread: next }, true)}
      />
      <ShadowColorRow color={shadow.color} busy={busy} onChange={(color, live) => onChange({ color: color }, live)} />
    </div>
  );
}

export const BOX_SHADOW_PREVIEW_CHECKERBOARD = 'conic-gradient(#8883 25%, transparent 0 50%, #8883 0 75%, transparent 0) 0 0 / 10px 10px';

export function BoxShadowsRow({ props }: { props: Props }) {
  const { read, busy } = props;
  const translate = useTranslate();
  const display = displayOf(read('box-shadow'));
  const rows = parseHideable(display.present ? display.value : '', ',', parseBoxShadows);
  const shadows = rows.map((row) => row.item);
  const write = (next: Array<Hideable<BoxShadow>>, options: WriteOptions) =>
    writeValue('box-shadow', serializeHideable(next, ',', serializeBoxShadows), options, props);
  const stack = useLayerRows({ rows, blank: blankBoxShadow, write });
  const { openIndex } = stack;
  const openShadow = openIndex === undefined ? undefined : shadows[openIndex];
  return (
    <div className="embed-editor_type-shadows">
      <div className="embed-editor_bg-layers-head">
        <EffLabel label={translate('style.boxShadowsRow.boxShadows')} prop="box-shadow" props={props} />
        <button
          type="button"
          className="embed-editor_icon-btn"
          onClick={stack.add}
          disabled={busy}
          title={translate('style.boxShadowsRow.addShadow')}
          aria-label={translate('style.boxShadowsRow.addBoxShadow')}
        >
          <PlusIcon />
        </button>
      </div>
      <LayerList
        count={shadows.length}
        busy={busy}
        ariaLabel={translate('style.boxShadowsRow.boxShadows')}
        onOpen={stack.open}
        onReorder={stack.reorder}
        onRemove={stack.remove}
        isHidden={stack.isHidden}
        onToggleHidden={stack.toggle}
        renderRow={(i) => boxShadowRow(shadows, i, translate)}
      />
      {openIndex !== undefined && stack.anchorElement && openShadow ? (
        <LayerPopover anchorEl={stack.anchorElement} ariaLabel={translate('style.boxShadowsRow.boxShadow')} onClose={stack.close}>
          <BoxShadowEditor shadow={openShadow} busy={busy} onChange={(patch, live) => stack.update(openIndex, { live }, (item) => ({ ...item, ...patch }))} />
        </LayerPopover>
      ) : undefined}
    </div>
  );
}

export function boxShadowRow(shadows: BoxShadow[], i: number, translate: Translator) {
  const shadow = shadows[i];
  if (shadow === undefined) {
    throw new Error(`Box shadow ${i} is missing`);
  }
  return {
    preview: (
      <span
        className="embed-editor_bg-layer-preview"
        style={{
          background: `linear-gradient(${shadow.color}, ${shadow.color}), ` + BOX_SHADOW_PREVIEW_CHECKERBOARD,
        }}
        aria-hidden="true"
      />
    ),
    label: boxShadowLabel(shadow, translate),
  };
}
