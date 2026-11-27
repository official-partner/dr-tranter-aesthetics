import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import ColorSwatch from './components/ColorSwatch';
import {
  clampedPercent,
  formatPercent,
  gradientCenter,
  serializeGradient,
  stopPercent,
  stopPositionWritable,
  stopsBarCss,
  type Gradient,
  type GradientPatch,
  type GradientStop,
  type GradientStopPatch,
} from './model/gradient';
import { commitInPlace } from './model/commitStyleInPlace';
import VariableConnect from './VariableConnect';
import { PositionGrid, NumberField } from './components/PositionGrid';
import { RadialSizeControl, RepeatIcon, type WriteOptions, AngleControl } from './GradientControls';
import { useTranslate } from '../../lib/i18n/useTranslate';
export { AngleControl } from './GradientControls';

function gradientBarStyle(image: string): CSSProperties & { readonly '--grad-image': string } {
  return { '--grad-image': image };
}

function stopStyle(left: number, color: string): CSSProperties & { readonly '--stop-color': string } {
  return { left: `${left}%`, '--stop-color': color };
}


type Props = {
  gradient: Gradient;
  busy: boolean;
  onChange: (g: Gradient, live: boolean) => void;
};

export default function GradientEditor({ gradient, busy, onChange }: Props) {
  const draft = useGradientDraft(gradient, onChange);
  const { patch, patchStops, setStop, editingRef } = draft;
  const current = draft.gradient;
  const stops = current.stops;
  const [selected, setSelected] = useState(0);
  const selectedIndex = Math.max(0, Math.min(selected, stops.length - 1));
  const sortStops = (keep: number) => {
    const sorted = sortedStops(stops, keep);
    setSelected(sorted.selected);
    patchStops(sorted.stops, { live: false });
  };
  const removeStop = (index: number) => {
    if (stops.length <= 2) {
      return;
    }
    patchStops(
      stops.filter((_, other) => other !== index),
      { live: false },
    );
    setSelected((previous) => Math.max(0, Math.min(previous, stops.length - 2)));
  };
  useDeleteStopKey({ busy, selectedIndex, stopCount: stops.length, removeStop });
  const stop = stops[selectedIndex] ?? { color: '', pos: '' };

  return (
    <div className="embed-editor_grad">
      {}
      <GradientGeometry gradient={current} busy={busy} patch={patch} />
      <StopsBar
        stops={stops}
        busy={busy}
        selectedIndex={selectedIndex}
        editingRef={editingRef}
        setSelected={setSelected}
        setStop={setStop}
        patchStops={patchStops}
        sortStops={sortStops}
        removeStop={removeStop}
      />
      <RepeatRow gradient={current} busy={busy} patch={patch} patchStops={patchStops} />
      <StopFields stop={stop} stops={stops} selectedIndex={selectedIndex} busy={busy} editingRef={editingRef} setStop={setStop} sortStops={sortStops} />
    </div>
  );
}

type Patch = (patch: GradientPatch, options?: WriteOptions) => void;
type PatchStops = (next: GradientStop[], options?: WriteOptions) => void;
type SetStop = (index: number, patch: GradientStopPatch, options?: WriteOptions) => void;

function useGradientDraft(gradient: Gradient, onChange: Props['onChange']) {
  const external = useMemo(() => serializeGradient(gradient), [gradient]);
  const [draft, setDraft] = useState<Gradient>(gradient);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(gradient);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized value
  }, [external]);
  const push = (next: Gradient, options: WriteOptions) => {
    setDraft(next);
    onChange(next, options.live);
  };
  const patch: Patch = (changes, options = { live: false }) => push({ ...draft, ...changes }, options);
  const patchStops: PatchStops = (next, options = { live: false }) => push({ ...draft, stops: next }, options);
  const setStop: SetStop = (index, changes, options = { live: false }) =>
    patchStops(
      draft.stops.map((stop, other) => (other === index ? { ...stop, ...changes } : stop)),
      options,
    );
  return { gradient: draft, editingRef: editing, patch, patchStops, setStop };
}

function sortedStops(stops: GradientStop[], keep: number): { stops: GradientStop[]; selected: number } {
  const tagged = stops.map((stop, index) => ({
    stop,
    index,
    percent: stopPercent(stops, index),
  }));
  tagged.sort((left, right) => left.percent - right.percent || left.index - right.index);
  return {
    stops: tagged.map((entry) => entry.stop),
    selected: tagged.findIndex((entry) => entry.index === keep),
  };
}

function insertedStops(stops: GradientStop[], percent: number): { stops: GradientStop[]; selected: number } {
  let nearest = 0;
  let best = Infinity;
  stops.forEach((_, index) => {
    const distance = Math.abs(stopPercent(stops, index) - percent);
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  });
  const position = formatPercent(percent);
  const next = [...stops, { color: stops[nearest]?.color ?? '#000000', pos: position }];
  const tagged = next.map((stop, index) => ({
    stop,
    percent: index === next.length - 1 ? percent : stopPercent(next, index),
  }));
  tagged.sort((left, right) => left.percent - right.percent);
  const sorted = tagged.map((entry) => entry.stop);
  return { stops: sorted, selected: sorted.findIndex((stop) => stop.pos === position) };
}

function barPercent(bar: HTMLElement, clientX: number): number | undefined {
  const rect = bar.getBoundingClientRect();
  if (rect.width > 0) {
    const fraction = (clientX - rect.left) / rect.width;
    return Number.isFinite(fraction) ? clampedPercent(Math.round(fraction * 100)) : undefined;
  }
  return undefined;
}

function useDeleteStopKey(state: { busy: boolean; selectedIndex: number; stopCount: number; removeStop: (index: number) => void }) {
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { busy, selectedIndex, stopCount, removeStop } = latest.current;
      if (busy || (event.key !== 'Delete' && event.key !== 'Backspace')) {
        return;
      }
      if (isTextEntry(document.activeElement ?? undefined)) {
        return;
      }
      if (selectedIndex < 0 || selectedIndex >= stopCount || stopCount <= 2) {
        return;
      }
      event.preventDefault();
      removeStop(selectedIndex);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function isTextEntry(element: Element | undefined): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return true;
  }
  return element.tagName === 'SELECT' || element.isContentEditable;
}

function GradientGeometry({ gradient, busy, patch }: { gradient: Gradient; busy: boolean; patch: Patch }) {
  const translate = useTranslate();
  if (gradient.type === 'radial') {
    return (
      <>
        <RadialPosition gradient={gradient} busy={busy} patch={patch} />
        <div className="embed-editor_size-row">
          <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.gradientEditor.size')}</span>
          <RadialSizeControl value={gradient.size.trim() || 'farthest-corner'} busy={busy} onChange={(size) => patch({ size })} />
        </div>
      </>
    );
  }
  if (gradient.type === 'linear') {
    return (
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.gradientEditor.angle')}</span>
        <AngleControl angle={gradient.angle} busy={busy} onChange={(angle, live) => patch({ angle }, { live })} />
      </div>
    );
  }
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.gradientEditor.angle')}</span>
      <NumberField
        value={gradient.from.replace(/deg$/i, '') || '0'}
        unit="deg"
        label={translate('style.gradientEditor.gradientAngle')}
        busy={busy}
        onLive={(next) => patch({ from: next }, { live: true })}
        onCommit={(next) => patch({ from: next })}
      />
    </div>
  );
}

function RadialPosition({ gradient, busy, patch }: { gradient: Gradient; busy: boolean; patch: Patch }) {
  const translate = useTranslate();
  const center = gradientCenter(gradient);
  return (
    <div className="embed-editor_size-row embed-editor_grad-pos-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.gradientEditor.position')}</span>
      <div className="embed-editor_grad-pos">
        <PositionGrid x={center.x} y={center.y} busy={busy} onPick={(px, py) => patch({ posX: px, posY: py })} />
        <div className="embed-editor_grad-pos-fields">
          {}
          <div className="embed-editor_grad-pos-field">
            <span>{translate('style.gradientEditor.left')}</span>
            <NumberField
              value={center.x}
              unit="%"
              label={translate('style.gradientEditor.positionLeft')}
              busy={busy}
              onLive={(next) => patch({ posX: next }, { live: true })}
              onCommit={(next) => patch({ posX: next })}
            />
          </div>
          <div className="embed-editor_grad-pos-field">
            <span>{translate('style.gradientEditor.top')}</span>
            <NumberField
              value={center.y}
              unit="%"
              label={translate('style.gradientEditor.positionTop')}
              busy={busy}
              onLive={(next) => patch({ posY: next }, { live: true })}
              onCommit={(next) => patch({ posY: next })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StopsBar({
  stops,
  busy,
  selectedIndex,
  editingRef,
  setSelected,
  setStop,
  patchStops,
  sortStops,
  removeStop,
}: {
  stops: GradientStop[];
  busy: boolean;
  selectedIndex: number;
  editingRef: React.MutableRefObject<boolean>;
  setSelected: (index: number) => void;
  setStop: SetStop;
  patchStops: PatchStops;
  sortStops: (keep: number) => void;
  removeStop: (index: number) => void;
}) {
  const translate = useTranslate();
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useStopDrag({ barRef, stops, busy, editingRef, setSelected, setStop, sortStops });
  const onBarClick = (event: React.MouseEvent) => {
    const bar = barRef.current;
    if (busy || drag.dragStop.current !== undefined || !bar) {
      return;
    }
    const percent = barPercent(bar, event.clientX);
    if (percent === undefined) {
      return;
    }
    const inserted = insertedStops(stops, percent);
    setSelected(inserted.selected);
    patchStops(inserted.stops, { live: false });
  };
  return (
    <div
      ref={barRef}
      className="embed-editor_grad-bar"
      style={gradientBarStyle(stopsBarCss(stops))}
      onClick={onBarClick}
      onPointerMove={drag.onHandleMove}
      onPointerUp={drag.onHandleUp}
    >
      {stops.map((stop, i) => (
        <button
          key={i}
          type="button"
          className={`embed-editor_grad-handle ${i === selectedIndex ? 'is-active' : ''}`}
          style={stopStyle(stopPercent(stops, i), stop.color.trim() || 'transparent')}
          disabled={busy}
          aria-label={translate('style.gradientEditor.stopAt', { number: i + 1, percent: stopPercent(stops, i) })}
          onClick={(event) => {
            event.stopPropagation();
            setSelected(i);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            removeStop(i);
          }}
          onPointerDown={drag.onHandleDown(i)}
        />
      ))}
    </div>
  );
}

function useStopDrag({
  barRef,
  stops,
  busy,
  editingRef,
  setSelected,
  setStop,
  sortStops,
}: {
  barRef: React.RefObject<HTMLDivElement>;
  stops: GradientStop[];
  busy: boolean;
  editingRef: React.MutableRefObject<boolean>;
  setSelected: (index: number) => void;
  setStop: SetStop;
  sortStops: (keep: number) => void;
}) {
  const dragStop = useRef<number | undefined>(undefined);
  const onHandleDown = (index: number) => (event: React.PointerEvent) => {
    if (busy) {
      return;
    }
    event.preventDefault();
    setSelected(index);
    dragStop.current = index;
    editingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandleMove = (event: React.PointerEvent) => {
    const index = dragStop.current;
    const bar = barRef.current;
    if (index === undefined || !bar) {
      return;
    }
    const percent = barPercent(bar, event.clientX);
    if (percent === undefined) {
      return;
    }
    const position = formatPercent(percent);
    if (stops[index]?.pos === position) {
      return;
    }
    setStop(index, { pos: position }, { live: true });
  };
  const onHandleUp = (event: React.PointerEvent) => {
    const index = dragStop.current;
    if (index === undefined) {
      return;
    }
    dragStop.current = undefined;
    editingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    sortStops(index);
  };
  return { dragStop, onHandleDown, onHandleMove, onHandleUp };
}

function RepeatRow({ gradient, busy, patch, patchStops }: { gradient: Gradient; busy: boolean; patch: Patch; patchStops: PatchStops }) {
  const translate = useTranslate();
  const stops = gradient.stops;
  return (
    <div className="embed-editor_size-row embed-editor_grad-repeat">
      <label className="embed-editor_grad-check">
        <input type="checkbox" checked={gradient.repeating} disabled={busy} onChange={(event) => patch({ repeating: event.target.checked })} />
        <span>{translate('style.gradientEditor.repeat')}</span>
      </label>
      <button
        type="button"
        className="embed-editor_icon-btn"
        disabled={busy}
        title={translate('style.gradientEditor.reverseStops')}
        aria-label={translate('style.gradientEditor.reverseGradientStops')}
        onClick={() =>
          patchStops(
            [...stops].reverse().map((stop, i) => ({
              ...stop,
              pos: stop.pos.trim() ? formatPercent(100 - stopPercent(stops, stops.length - 1 - i)) : '',
            })),
          )
        }
      >
        <RepeatIcon />
      </button>
    </div>
  );
}

function StopFields({
  stop,
  stops,
  selectedIndex,
  busy,
  editingRef,
  setStop,
  sortStops,
}: {
  stop: GradientStop;
  stops: GradientStop[];
  selectedIndex: number;
  busy: boolean;
  editingRef: React.MutableRefObject<boolean>;
  setStop: SetStop;
  sortStops: (keep: number) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.gradientEditor.color')}</span>
      <div className="embed-editor_grad-stop">
        <ColorSwatch
          value={stop.color}
          busy={busy}
          ariaLabel={translate('style.gradientEditor.stopColor')}
          onChange={(color, live) => {
            editingRef.current = live;
            setStop(selectedIndex, { color }, { live });
          }}
        />
        {}
        <VariableConnect
          className="is-fill"
          prop="color"
          disabled={busy}
          ariaLabel={translate('styleModel.shared.connectVariable', { label: translate('style.gradientEditor.stopColor') })}
          onPick={(binding) => setStop(selectedIndex, { color: binding })}
        >
          <input
            className="u-input embed-editor_grad-color"
            value={stop.color}
            spellCheck={false}
            disabled={busy}
            aria-label={translate('style.gradientEditor.stopColor')}
            onFocus={() => {
              editingRef.current = true;
            }}
            onChange={(event) => setStop(selectedIndex, { color: event.target.value }, { live: true })}
            onBlur={() => {
              editingRef.current = false;
              setStop(selectedIndex, { color: stop.color });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitInPlace(event.currentTarget);
              }
            }}
          />
        </VariableConnect>
        <NumberField
          value={stop.pos || `${Math.round(stopPercent(stops, selectedIndex))}%`}
          unit="%"
          label={translate('style.gradientEditor.stopPosition')}
          busy={busy}
          onLive={(next) => {
            if (stopPositionWritable(next)) {
              setStop(selectedIndex, { pos: next }, { live: true });
            }
          }}
          onCommit={(next) => {
            if (!stopPositionWritable(next)) {
              return;
            }
            setStop(selectedIndex, { pos: next });
            sortStops(selectedIndex);
          }}
        />
      </div>
    </div>
  );
}
