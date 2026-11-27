
import { useEffect, useRef, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { hasCanvas, queryCanvas } from '../../editor/canvasQuery';
import { getHost } from './model/host';
import { layerShorthand, parseLayerShorthand, serializeLayers, type BgLayer } from './model/background';
import { customPropertiesIn, substituteCustomProperties } from './model/cssVars';
import { type LayerFieldProps } from './BackgroundLayerFields';
import VariableConnect from './VariableConnect';
import { useTranslate } from '../../lib/i18n/useTranslate';

export function useResolvedCustomProperties(texts: readonly string[]): ReadonlyMap<string, string> {
  const names = [...new Set(texts.flatMap(customPropertiesIn))].sort();
  const key = names.join(' ');
  const [resolved, setResolved] = useState<{ readonly key: string; readonly values: ReadonlyMap<string, string> }>({ key: '', values: new Map() });
  useEffect(() => {
    const host = getHost();
    const path = host.selectedId ? host.pathOf?.(host.selectedId) : undefined;
    const asked = key === '' ? [] : key.split(' ');
    if (path === undefined || !hasCanvas() || asked.length === 0 || asked.length > LIMITS.scanEntriesMax) {
      return undefined;
    }
    assert(
      asked.every((name) => name.startsWith('--')),
      'Only custom properties are asked about',
    );
    let live = true;
    void queryCanvas(path, [], [], asked).then((answer) => {
      if (live && answer !== undefined) {
        setResolved({ key, values: new Map(asked.map((name) => [name, answer.computedProps[name] ?? ''])) });
      }
    });
    return () => {
      live = false;
    };
  }, [key]);
  return resolved.key === key ? resolved.values : new Map();
}

export function layerPreviewStyle(layer: BgLayer, values: ReadonlyMap<string, string>): Record<string, string> {
  const fill = (text: string): string => substituteCustomProperties(text, values);
  const style: Record<string, string> = { backgroundImage: fill(layer.image) };
  if (layer.size.trim() !== '') {
    style['backgroundSize'] = fill(layer.size);
  }
  if (layer.position.trim() !== '') {
    style['backgroundPosition'] = fill(layer.position);
  }
  if (layer.repeat.trim() !== '') {
    style['backgroundRepeat'] = layer.repeat.trim();
  }
  assert(style['backgroundImage'] !== undefined, 'layerPreviewStyle: a layer paints an image');
  return style;
}

export type GradientCodeProps = Pick<LayerFieldProps, 'layers' | 'index' | 'busy' | 'liveSetProp'> & {
  readonly applyLayers: (layers: BgLayer[]) => void;
};

export function GradientCode(props: GradientCodeProps) {
  const { layers, index, busy, applyLayers, liveSetProp } = props;
  const translate = useTranslate();
  const layer = layers[index];
  assert(layer !== undefined, 'GradientCode: the layer exists');
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const cancelledRef = useRef(false);
  const saved = layerShorthand(layer);
  const text = draft ?? saved;
  const drafted = parseLayerShorthand(text) ?? layer;
  const values = useResolvedCustomProperties([drafted.image, drafted.size, drafted.position]);
  const stackWith = (next: BgLayer): BgLayer[] => layers.map((entry, i) => (i === index ? next : entry));
  const preview = (next: BgLayer): void => {
    const longhands = serializeLayers(stackWith(next));
    for (const [prop, list] of [
      ['background-image', longhands.image],
      ['background-size', longhands.size],
      ['background-position', longhands.position],
      ['background-repeat', longhands.repeat],
      ['background-attachment', longhands.attachment],
    ] as const) {
      if (list !== '') {
        liveSetProp(prop, list, false);
      }
    }
  };
  const onDraft = (value: string): void => {
    setDraft(value);
    const next = parseLayerShorthand(value);
    if (next !== undefined) {
      preview(next);
    }
  };
  const save = (): void => {
    const cancelled = cancelledRef.current;
    cancelledRef.current = false;
    const next = draft === undefined || cancelled ? undefined : parseLayerShorthand(draft);
    setDraft(undefined);
    if (next === undefined) {
      return;
    }
    if (layerShorthand(next) !== saved) {
      applyLayers(stackWith(next));
    }
  };
  return (
    <>
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.gradientCode.preview')}</span>
        <div className="embed-editor_gradient-code-preview" aria-hidden="true">
          <span style={layerPreviewStyle(drafted, values)} />
        </div>
      </div>
      <div
        className="embed-editor_gradient-code"
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
            return;
          }
          save();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelledRef.current = true;
            preview(layer);
            const focused = document.activeElement;
            if (focused instanceof HTMLElement) {
              focused.blur();
            }
          }
        }}
      >
        <VariableConnect
          className="is-multiline"
          code
          expanded
          ariaLabel={translate('style.gradientCode.layerCode')}
          disabled={busy}
          prop="background"
          onDraft={onDraft}
          onPick={onDraft}
        >
          <textarea
            className="embed-editor_gradient-code-field"
            value={text}
            spellCheck={false}
            rows={4}
            disabled={busy}
            aria-label={translate('style.gradientCode.layerCode')}
            onChange={(event) => onDraft(event.target.value)}
          />
        </VariableConnect>
      </div>
    </>
  );
}
