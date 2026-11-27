
import { assert } from '../../../shared/core/assert';
import SegmentedControl from '../../ui/SegmentedControl';
import { blankLayer, layerKind, serializeLayers, type BgLayer, type LayerKind } from './model/background';
import { gradientFitsEditor, parseGradient, serializeGradient, type GradientType } from './model/gradient';
import { GradientCode } from './GradientCode';
import GradientEditor from './GradientEditor';
import { type WriteOptions, replaceLayer } from './BackgroundKit';
import {
  LayerLonghandField,
  typeOptions,
  type LayerFieldProps,
  LayerSizeField,
  LayerPositionField,
  tileOptions,
  fixedOptions,
  LayerImageField,
  LayerColorField,
} from './BackgroundLayerFields';
import { useTranslate } from '../../lib/i18n/useTranslate';

const GRADIENT_PLACEHOLDER = 'gradient(…)';

export type LayerEditorProps = LayerFieldProps & { applyLayers: (layers: BgLayer[]) => void };

export function LayerEditor(props: LayerEditorProps) {
  const translate = useTranslate();
  const { layers, index, busy, setProp, liveSetProp } = props;
  const layer = layers[index];
  if (!layer) {
    return undefined;
  }
  const kind = layerKind(layer.image);
  const displayKind = displayKindOf(kind);
  const typeRow = (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.type')}</span>
      <SegmentedControl
        options={typeOptions(translate)}
        value={displayKind}
        onChange={(next) => setLayerKind({ next, displayKind, props })}
        ariaLabel={translate('style.backgroundLayerEditor.layerType')}
        disabled={busy}
      />
    </div>
  );

  if (displayKind === 'color') {
    return (
      <div className="embed-editor_bg-editor">
        {typeRow}
        <div className="embed-editor_size-row">
          <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.color')}</span>
          <LayerColorField layers={layers} index={index} busy={busy} setProp={setProp} liveSetProp={liveSetProp} />
        </div>
      </div>
    );
  }

  const isGradient = kind === 'linear' || kind === 'radial' || kind === 'conic';
  const gradient = isGradient ? parseGradient(layer.image) : undefined;
  const writeImage = (image: string, options: WriteOptions) => {
    const list = serializeLayers(replaceLayer(layers, index, { image })).image;
    if (options.live) {
      liveSetProp('background-image', list, false);
    } else {
      setProp('background-image', list, false);
    }
  };

  return (
    <div className="embed-editor_bg-editor">
      {typeRow}
      {gradient !== undefined && gradientFitsEditor(gradient) ? (
        <GradientEditor gradient={gradient} busy={busy} onChange={(next, live) => writeImage(serializeGradient(next), { live })} />
      ) : isGradient ? (
        <GradientCode layers={layers} index={index} busy={busy} applyLayers={props.applyLayers} liveSetProp={liveSetProp} />
      ) : (
        <LayerRawFields displayKind={displayKind} props={props} />
      )}
      {}
      {!isGradient ? <LayerTileFields layer={layer} props={props} /> : undefined}
    </div>
  );
}

export function displayKindOf(kind: ReturnType<typeof layerKind>): LayerKind {
  if (kind === 'color' || kind === 'linear' || kind === 'radial') {
    return kind;
  }
  return kind === 'conic' ? 'linear' : 'image';
}

export const isGradientType = (value: LayerKind): value is GradientType => value === 'linear' || value === 'radial' || value === 'conic';

export function setLayerKind({ next, displayKind, props }: { next: LayerKind; displayKind: LayerKind; props: LayerEditorProps }) {
  const { layers, index, applyLayers } = props;
  const layer = layers[index];
  if (next === displayKind || layer === undefined) {
    return;
  }
  const seeded = blankLayer(next);
  assert(layerKind(seeded.image) === next, 'setLayerKind: the new layer is of the kind asked for');
  applyLayers(layers.map((entry, i) => (i === index ? { ...seeded, origin: layer.origin, clip: layer.clip } : entry)));
}

export function LayerRawFields({ displayKind, props }: { displayKind: LayerKind; props: LayerEditorProps }) {
  const translate = useTranslate();
  const { applyLayers, ...fieldProps } = props;
  return (
    <>
      <div className="embed-editor_size-row embed-editor_bg-row-top">
        <span className="embed-editor_size-label embed-editor_bg-caption">
          {displayKind === 'image' ? translate('style.backgroundLayerEditor.image') : translate('style.backgroundLayerEditor.gradient')}
        </span>
        {displayKind === 'image' ? (
          <LayerImageField layers={fieldProps.layers} index={fieldProps.index} busy={fieldProps.busy} applyLayers={applyLayers} />
        ) : (
          <LayerLonghandField
            {...fieldProps}
            field="image"
            prop="background-image"
            label={translate('style.backgroundLayerEditor.layerValue')}
            placeholder={GRADIENT_PLACEHOLDER}
          />
        )}
      </div>
      <div className="embed-editor_size-row embed-editor_bg-row-top">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.size')}</span>
        <LayerSizeField {...fieldProps} />
      </div>
      <div className="embed-editor_size-row embed-editor_bg-row-top">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.position')}</span>
        <LayerPositionField {...fieldProps} />
      </div>
    </>
  );
}

export function LayerTileFields({ layer, props }: { layer: BgLayer; props: LayerEditorProps }) {
  const translate = useTranslate();
  const { layers, index, busy, applyLayers } = props;
  return (
    <>
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.tile')}</span>
        <SegmentedControl
          options={tileOptions(translate)}
          value={['repeat-x', 'repeat-y', 'no-repeat'].includes(layer.repeat.trim()) ? layer.repeat.trim() : 'repeat'}
          onChange={(next) => applyLayers(replaceLayer(layers, index, { repeat: next === 'repeat' ? '' : next }))}
          ariaLabel={translate('style.backgroundLayerEditor.layerTile')}
          disabled={busy}
        />
      </div>
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.fixed')}</span>
        <SegmentedControl
          options={fixedOptions(translate)}
          value={layer.attachment.trim() === 'fixed' ? 'fixed' : 'scroll'}
          onChange={(next) => applyLayers(replaceLayer(layers, index, { attachment: next === 'scroll' ? '' : next }))}
          ariaLabel={translate('style.backgroundLayerEditor.layerFixed')}
          disabled={busy}
        />
      </div>
    </>
  );
}
