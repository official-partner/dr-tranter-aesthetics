import { useState } from 'react';
import { layerPreviewStyle, useResolvedCustomProperties } from './GradientCode';
import { VariableSelect, variableIn } from './KeywordConnect';
import { RatioOtherInput } from './AspectRatioField';
import { blankLayer, layerLabel, parseLayers, serializeLayers, splitBackgroundShorthand, splitTopLevelCommas, type BgLayer } from './model/background';
import LayerList from './LayerList';
import { PlusIcon } from './components/MenuParts';
import { openAfterRemoval } from './model/fieldHooks';
import { displayOf } from './model/styleDisplay';
import ImportantMark from './components/ImportantMark';
import { type Props, BgLabel, BgField, LayerEditorModal } from './BackgroundKit';
import { imageUrlOf, assetSourceCandidates, FallbackImg } from './BackgroundLayerFields';
import { LayerEditor } from './BackgroundLayerEditor';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { useHoverPreview } from './connectFieldHelpers';



const TRANSPARENT_KEYWORD = 'transparent';

export default function BackgroundSection(props: Props) {
  const { read, busy, clearProp, onProvenance, onSelectSelector } = props;
  const translate = useTranslate();
  const layerWriters = keepingImportant(props);
  const stack = useLayerStack({ ...props, ...layerWriters });
  const { layers, applyLayers, openLayer, setOpenLayer } = stack;
  const labelProp = layerSourceProp(read);
  return (
    <div className="embed-editor_size embed-editor_background">
      {}
      <div className="embed-editor_bg-layers-head">
        <BgLabel
          label={translate('style.backgroundSection.imageAndGradient')}
          prop={labelProp}
          d={displayOf(read(labelProp))}
          contributors={read(labelProp)?.contributors ?? []}
          busy={busy}
          onClear={() => applyLayers([])}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
        <button
          type="button"
          className="embed-editor_icon-btn"
          onClick={stack.addLayer}
          disabled={busy}
          title={translate('style.backgroundSection.addLayer')}
          aria-label={translate('style.backgroundSection.addBackgroundLayer')}
        >
          <PlusIcon />
        </button>
      </div>

      <LayerList
        count={layers.length}
        busy={busy}
        ariaLabel={translate('style.backgroundSection.backgroundLayers')}
        onOpen={(i) => setOpenLayer((current) => (current === i ? undefined : i))}
        onReorder={stack.reorder}
        onRemove={stack.removeLayer}
        renderRow={(i) => layerRow(layers, i, translate)}
      />

      {openLayer !== undefined && layers[openLayer] ? (
        <LayerEditorModal onClose={() => setOpenLayer(undefined)}>
          <LayerEditor
            layers={layers}
            index={openLayer}
            busy={busy}
            setProp={layerWriters.setProp}
            clearProp={clearProp}
            liveSetProp={layerWriters.liveSetProp}
            applyLayers={applyLayers}
          />
        </LayerEditorModal>
      ) : undefined}

      {}
      <div className="embed-editor_size-row">
        <BgField
          {...props}
          prop="background-color"
          label={translate('style.backgroundSection.color')}
          placeholder={TRANSPARENT_KEYWORD}
          swatchLabel={translate('style.backgroundSection.backgroundColor')}
        />
      </div>

      <ClippingRow {...props} />
    </div>
  );
}

function keepingImportant({ read, setProp, liveSetProp }: Props): Pick<Props, 'setProp' | 'liveSetProp'> {
  const fromShorthand = layerSourceProp(read) === 'background';
  const flagged = (prop: string): boolean => displayOf(read(prop)).important || (fromShorthand && displayOf(read('background')).important);
  return {
    setProp: (prop, value, important) => setProp(prop, value, important || flagged(prop)),
    liveSetProp: (prop, value, important) => liveSetProp(prop, value, important || flagged(prop)),
  };
}

function ClippingRow(props: Props) {
  const hoverPreview = useHoverPreview();
  const { read, busy, setProp, clearProp, liveSetProp } = props;
  const translate = useTranslate();
  const clipDisplay = displayOf(read('background-clip'));
  const clipVariable = clipDisplay.present && variableIn(clipDisplay.value) !== undefined;
  const clip = clipDisplay.present ? clipDisplay.value.trim() : 'border-box';
  return (
    <div className="embed-editor_size-row">
      <BgLabel
        label={translate('style.backgroundSection.clipping')}
        prop="background-clip"
        d={clipDisplay}
        contributors={read('background-clip')?.contributors ?? []}
        busy={busy}
        onClear={() => clearProp('background-clip')}
        onProvenance={props.onProvenance}
        onSelectSelector={props.onSelectSelector}
      />
      {}
      <ImportantMark important={clipDisplay.important}>
        <VariableSelect
          prop="background-clip"
          rawValue={clipDisplay.present ? clipDisplay.value : ''}
          onVariable={(binding) => setProp('background-clip', binding, clipDisplay.important)}
          customInput={
            clipVariable ? (
              <RatioOtherInput
                value={clipDisplay.value}
                busy={busy}
                prop="background-clip"
                ariaLabel={translate('style.backgroundSection.backgroundClipping')}
                onCommit={(value, important) => setProp('background-clip', value, important || clipDisplay.important)}
                onLiveCommit={(value, important) => liveSetProp('background-clip', value, important || clipDisplay.important)}
                onClear={() => clearProp('background-clip')}
              />
            ) : undefined
          }
          value={clip}
          options={clipOptions(translate)}
          onChange={(next) => setProp('background-clip', next, clipDisplay.important)}
          onPreview={(next) => hoverPreview('background-clip', next ?? undefined, clipDisplay.important)}
          ariaLabel={translate('style.backgroundSection.backgroundClipping')}
          disabled={busy}
        />
      </ImportantMark>
    </div>
  );
}

export const clipOptions = (translate: Translator) => [
  { value: 'border-box', label: translate('style.backgroundSection.clipNone') },
  { value: 'padding-box', label: translate('style.backgroundSection.clipPadding') },
  { value: 'content-box', label: translate('style.backgroundSection.clipContent') },
  { value: 'text', label: translate('style.backgroundSection.clipText') },
];

export function layerSourceProp(read: Props['read']): 'background-image' | 'background' {
  const image = displayOf(read('background-image'));
  if (image.present && image.value.trim() !== '' && image.value.trim().toLowerCase() !== 'none') {
    return 'background-image';
  }
  return displayOf(read('background')).present ? 'background' : 'background-image';
}

export function layerRow(layers: BgLayer[], i: number, translate: Translator) {
  const layer = layers[i];
  if (layer === undefined) {
    throw new Error(`Background layer ${i} is missing`);
  }
  return { preview: <LayerPreview layer={layer} />, label: layerLabel(layer.image, translate) };
}

function LayerPreview({ layer }: { layer: BgLayer }) {
  const url = imageUrlOf(layer.image);
  const values = useResolvedCustomProperties([layer.image, layer.size, layer.position]);
  if (!url) {
    return (
      <span
        className="embed-editor_bg-layer-preview"
        style={{ backgroundSize: 'cover', backgroundPosition: 'center', ...layerPreviewStyle(layer, values) }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="embed-editor_bg-layer-preview is-image" aria-hidden="true">
      <FallbackImg srcs={assetSourceCandidates(url)} />
    </span>
  );
}

function useLayerStack({ read, setProp, clearProp }: Props) {
  const valueOf = (prop: string) => displayOf(read(prop)).value;

  const rawImage = valueOf('background-image').trim();
  const shorthand = valueOf('background').trim();
  const fromShorthand = (!rawImage || rawImage.toLowerCase() === 'none') && !!shorthand;
  const variables = useResolvedCustomProperties([fromShorthand ? shorthand : '']);
  const longhands = fromShorthand
    ? splitBackgroundShorthand(shorthand, variables)
    : {
        image: valueOf('background-image'),
        size: valueOf('background-size'),
        position: valueOf('background-position'),
        repeat: valueOf('background-repeat'),
        attachment: valueOf('background-attachment'),
        origin: '',
        clip: '',
        color: '',
      };
  const boxes = {
    origin: boxSource(read, 'background-origin', longhands.origin),
    clip: boxSource(read, 'background-clip', longhands.clip),
  };
  const layers = parseLayers({ ...longhands, origin: boxes.origin.list, clip: boxes.clip.list });

  const applyLayers = (next: BgLayer[]) => {
    writeLonghands(next, boxes, { read, setProp, clearProp, keepOwn: fromShorthand });
    if (fromShorthand) {
      clearProp('background');
      if (longhands.color && !valueOf('background-color').trim()) {
        setProp('background-color', longhands.color, false);
      }
    }
  };

  const [openLayer, setOpenLayer] = useState<number | undefined>(undefined);
  const addLayer = () => {
    applyLayers([blankLayer('image'), ...layers]);
    setOpenLayer(0);
  };
  const removeLayer = (index: number) => {
    applyLayers(layers.filter((_, i) => i !== index));
    setOpenLayer((current) => openAfterRemoval(current, index));
  };
  const reorder = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    const next = [...layers];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(to, 0, moved);
    applyLayers(next);
    setOpenLayer((current) => (current === from ? to : current));
  };
  return { layers, applyLayers, openLayer, setOpenLayer, addLayer, removeLayer, reorder };
}

type BoxSource = { readonly list: string; readonly listed: boolean; readonly single: string };

function boxSource(read: Props['read'], prop: string, fromShorthand: string): BoxSource {
  const display = displayOf(read(prop));
  const own = display.present && display.isSelected ? display.value.trim() : '';
  if (own === '') {
    return { list: fromShorthand, listed: false, single: '' };
  }
  const listed = splitTopLevelCommas(own).length > 1;
  return listed ? { list: own, listed, single: '' } : { list: '', listed, single: own };
}

function writeLonghands(
  layers: BgLayer[],
  boxes: { readonly origin: BoxSource; readonly clip: BoxSource },
  { read, setProp, clearProp, keepOwn }: Pick<Props, 'read' | 'setProp' | 'clearProp'> & { readonly keepOwn: boolean },
) {
  const ownValue = (prop: string): string | undefined => {
    const display = displayOf(read(prop));
    return display.present && display.isSelected ? display.value.trim() : undefined;
  };
  const write = (prop: string, value: string) => {
    const own = ownValue(prop);
    const trimmed = value.trim();
    if (trimmed) {
      if (own !== trimmed) {
        setProp(prop, trimmed, false);
      }
    } else if (own !== undefined && !keepOwn) {
      clearProp(prop);
    }
  };
  const serialized = serializeLayers(layers);
  write('background-image', serialized.image);
  write('background-size', serialized.size);
  write('background-position', serialized.position);
  write('background-repeat', serialized.repeat);
  write('background-attachment', serialized.attachment);
  for (const key of ['origin', 'clip'] as const) {
    const source = boxes[key];
    if (source.listed || layers.some((layer) => layer[key].trim())) {
      write(`background-${key}`, serializeLayers(layers.map((layer) => ({ ...layer, [key]: layer[key] || source.single })))[key]);
    }
  }
}
