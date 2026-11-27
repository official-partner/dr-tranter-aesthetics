import { useTranslate } from '../../../lib/i18n/useTranslate';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Popup from '../../../ui/Popup';
import { colorMode, formatColor, formatHex, hsvaToRgba, parseColor, rgbaToHsl, rgbaToHsva, type ColorMode, type HSVA, type RGBA } from '../model/colorSpace';
import { dragNote, endDragNotes } from '../../../ui/sound';
import type { CSSProperties, RefObject } from 'react';
import { commitInPlace } from '../model/commitStyleInPlace';

type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };

function isEyeDropperConstructor(candidate: unknown): candidate is EyeDropperConstructor {
  return typeof candidate === 'function';
}

function readEyeDropper(): EyeDropperConstructor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'EyeDropper');
  const candidate: unknown = descriptor?.value;
  return isEyeDropperConstructor(candidate) ? candidate : undefined;
}


type Props = {
  value: string;
  anchor: DOMRect;
  trigger?: HTMLElement | undefined;
  onChange: (color: string, live: boolean) => void;
  onClose: () => void;
};

const CHECKER = 'repeating-conic-gradient(#808080 0% 25%, #a0a0a0 0% 50%) 50% / 10px 10px';
const HUE_BAR = 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

function checkerStyle(): CSSProperties & { readonly '--picker-checker': string } {
  return { '--picker-checker': CHECKER };
}

type DragPhase = 'live' | 'final';

function useDrag({ tall = false, onMove }: { readonly tall?: boolean; readonly onMove: (fx: number, fy: number, phase: DragPhase) => void }) {
  return (element: HTMLElement, event: React.PointerEvent) => {
    const rect = element.getBoundingClientRect();
    const report = (event: PointerEvent | React.PointerEvent, phase: DragPhase) => {
      const fx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const fy = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      if (phase === 'live') {
        dragNote(fx, tall ? fy : undefined);
      }
      onMove(fx, fy, phase);
    };
    report(event, 'live');
    const move = (event: PointerEvent) => report(event, 'live');
    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      report(event, 'final');
      endDragNotes();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

function Field({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(value);
    }
  }, [value]);
  return (
    <label className={`u-color-field ${wide ? 'is-wide' : ''}`}>
      <input
        className="u-input u-color-field-input"
        value={text}
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
        onFocus={(event) => {
          focused.current = true;
          event.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitInPlace(event.currentTarget);
            return;
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
            return;
          }
          const parsed = parseFloat(text);
          if (Number.isNaN(parsed)) {
            return;
          }
          event.preventDefault();
          const next = String(parsed + (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1));
          setText(next);
          onChange(next);
        }}
        aria-label={label}
      />
    </label>
  );
}

const EYEDROPPER_ICON_PATH = 'M10.5 2.5a1.7 1.7 0 0 1 2.4 2.4l-1 1 1 1-1.2 1.2-1-1' + 'L6 12.8 3 13.5l.7-3 4.1-4.1-1-1L8 4.2l1 1 1-1a1.7 1.7 0 0 1 .5-.4Z';

const EyedropperIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
    <path d={EYEDROPPER_ICON_PATH} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);

export default function ColorPicker({ value, anchor, trigger, onChange, onClose }: Props) {
  const translate = useTranslate();
  const initial = useRef<RGBA>(parseColor(value) ?? { r: 0, g: 0, b: 0, a: value.trim() ? 1 : 0 });
  const [hsva, setHsva] = useState<HSVA>(() => rgbaToHsva(initial.current));
  const notation = useNotation(value, hsva, onChange);
  const rootRef = useRef<HTMLDivElement>(null);
  const position = usePickerPosition(rootRef, anchor);
  const alpha = useAlphaChoice();

  const emit = (next: HSVA, phase: DragPhase) => {
    setHsva(next);
    onChange(formatColor(hsvaToRgba(next), notation.mode), phase === 'live');
  };
  const setFromColor = (input: string) => {
    const picked = parseColor(input);
    if (!picked) {
      return;
    }
    alpha.choose();
    const next = rgbaToHsva(picked);
    if (next.s === 0) {
      next.h = hsva.h;
    }
    if (next.v === 0 || next.s === 0) {
      next.s = next.s === 0 ? hsva.s : next.s;
    }
    setHsva(next);
    onChange(formatColor(picked, notation.mode), false);
  };
  const setNumber = (key: 'h' | 's' | 'v' | 'a', raw: string, max: number) => {
    const amount = parseFloat(raw);
    if (Number.isNaN(amount)) {
      return;
    }
    if (key === 'a') {
      alpha.choose();
    }
    const next = {
      ...hsva,
      [key]: key === 'a' ? clamp(amount / 100, 0, 1) : clamp(amount, 0, max),
    };
    emit(key === 'a' ? next : alpha.carry(next), 'final');
  };

  return (
    <Popup
      mode="popover"
      anchor={trigger}
      onClose={onClose}
      ref={rootRef}
      className="u-color-picker"
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
      role="dialog"
      label={translate('styleModel.components.colorPicker.title')}
    >
      <PickerSurfaces hsva={hsva} alpha={alpha} emit={emit} onPicked={setFromColor} />
      <PickerInputs hsva={hsva} channel={notation.channel} onColor={setFromColor} onNumber={setNumber} />
      <NotationRow notation={notation} />
    </Popup>
  );
}

type Notation = ReturnType<typeof useNotation>;
type AlphaChoice = ReturnType<typeof useAlphaChoice>;

function useNotation(value: string, hsva: HSVA, onChange: Props['onChange']) {
  const [channel, setChannel] = useState<'rgb' | 'hsl'>(() => (colorMode(value) === 'hsl' ? 'hsl' : 'rgb'));
  const [asHex, setAsHex] = useState(() => !!value.trim() && colorMode(value) === 'hex');
  const mode: ColorMode = asHex ? 'hex' : channel;
  const writeAs = (next: ColorMode) => {
    if (value.trim()) {
      onChange(formatColor(hsvaToRgba(hsva), next), false);
    }
  };
  const toggleChannel = () => {
    const next = asHex ? channel : channel === 'rgb' ? 'hsl' : 'rgb';
    setAsHex(false);
    setChannel(next);
    writeAs(next);
  };
  const chooseHex = () => {
    setAsHex(true);
    writeAs('hex');
  };
  return { channel, asHex, mode, toggleChannel, chooseHex };
}

function usePickerPosition(rootRef: RefObject<HTMLDivElement>, anchor: DOMRect) {
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const width = element.offsetWidth || 240;
    const height = element.offsetHeight || 300;
    const left = clamp(anchor.left, 8, window.innerWidth - width - 8);
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 && anchor.top - height - 6 > 8 ? anchor.top - height - 6 : below;
    setPosition({ top, left });
  }, [rootRef, anchor]);
  return position;
}

function useAlphaChoice() {
  const alphaChosen = useRef(false);
  return {
    choose: () => {
      alphaChosen.current = true;
    },
    carry: (next: HSVA): HSVA => (alphaChosen.current || next.a > 0 ? next : { ...next, a: 1 }),
  };
}

function PickerSurfaces({
  hsva,
  alpha,
  emit,
  onPicked,
}: {
  hsva: HSVA;
  alpha: AlphaChoice;
  emit: (next: HSVA, phase: DragPhase) => void;
  onPicked: (color: string) => void;
}) {
  const rgba = hsvaToRgba(hsva);
  const hueColor = formatHex({ ...hsvaToRgba({ h: hsva.h, s: 100, v: 100, a: 1 }), a: 1 });
  const dragSB = useDrag({
    tall: true,
    onMove: (fx, fy, phase) => emit(alpha.carry({ ...hsva, s: Math.round(fx * 100), v: Math.round((1 - fy) * 100) }), phase),
  });
  const dragHue = useDrag({
    onMove: (fx, _fy, phase) => emit(alpha.carry({ ...hsva, h: Math.round(fx * 360) }), phase),
  });
  const dragAlpha = useDrag({
    onMove: (fx, _fy, phase) => {
      alpha.choose();
      emit({ ...hsva, a: Math.round(fx * 100) / 100 }, phase);
    },
  });
  return (
    <>
      <div
        className="u-color-sb"
        style={{
          background: 'linear-gradient(to top, #000, transparent), ' + `linear-gradient(to right, #fff, ${hueColor})`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          dragSB(event.currentTarget, event);
        }}
      >
        <span className="u-color-sb-thumb" style={{ left: `${hsva.s}%`, top: `${100 - hsva.v}%`, background: formatHex(rgba) }} />
      </div>
      <PickerSliders hsva={hsva} dragHue={dragHue} dragAlpha={dragAlpha} onPicked={onPicked} />
    </>
  );
}

type DragStart = (element: HTMLElement, event: React.PointerEvent) => void;

function PickerSliders({ hsva, dragHue, dragAlpha, onPicked }: { hsva: HSVA; dragHue: DragStart; dragAlpha: DragStart; onPicked: (color: string) => void }) {
  const translate = useTranslate();
  const eyedrop = () => {
    const EyeDropper = readEyeDropper();
    if (!EyeDropper) {
      return;
    }
    new EyeDropper()
      .open()
      .then((result) => onPicked(result.sRGBHex))
      .catch(() => {
      });
  };
  return (
    <div className="u-color-sliders">
      <button
        type="button"
        className={`u-color-eyedrop ${readEyeDropper() ? '' : 'is-hidden'}`}
        onClick={eyedrop}
        title={translate('styleModel.components.colorPicker.eyedropperTitle')}
        aria-label={translate('styleModel.components.colorPicker.eyedropper')}
      >
        <EyedropperIcon />
      </button>
      <div className="u-color-slider-stack">
        <div
          className="u-color-slider"
          style={{ background: HUE_BAR }}
          onPointerDown={(event) => {
            event.preventDefault();
            dragHue(event.currentTarget, event);
          }}
        >
          <span className="u-color-slider-thumb" style={{ left: `${(hsva.h / 360) * 100}%` }} />
        </div>
        <div
          className="u-color-slider u-color-alpha"
          style={checkerStyle()}
          onPointerDown={(event) => {
            event.preventDefault();
            dragAlpha(event.currentTarget, event);
          }}
        >
          <span
            className="u-color-alpha-fill"
            style={{
              background: `linear-gradient(to right, transparent, ${hueColorWithSat(hsva)})`,
            }}
          />
          <span className="u-color-slider-thumb" style={{ left: `${Math.round(hsva.a * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function channelLabels(channel: 'rgb' | 'hsl'): string[] {
  return channel === 'hsl' ? ['H', 'S', 'L'] : ['R', 'G', 'B'];
}

function PickerInputs({
  hsva,
  channel,
  onColor,
  onNumber,
}: {
  hsva: HSVA;
  channel: 'rgb' | 'hsl';
  onColor: (color: string) => void;
  onNumber: (key: 'h' | 's' | 'v' | 'a', raw: string, max: number) => void;
}) {
  const rgba = hsvaToRgba(hsva);
  const hsl = rgbaToHsl(rgba);
  const asHsl = channel === 'hsl';
  const channelValues = asHsl ? [String(hsl.h), String(hsl.s), String(hsl.l)] : [String(rgba.r), String(rgba.g), String(rgba.b)];
  const setChannel = (i: number, value: string) => {
    if (asHsl) {
      onColor(`hsla(${i === 0 ? value : hsl.h}, ${i === 1 ? value : hsl.s}%, ` + `${i === 2 ? value : hsl.l}%, ${rgba.a})`);
    } else {
      onColor(`rgba(${i === 0 ? value : rgba.r}, ${i === 1 ? value : rgba.g}, ` + `${i === 2 ? value : rgba.b}, ${rgba.a})`);
    }
  };
  return (
    <div className="u-color-inputs">
      <Field label="HEX" wide value={formatHex(rgba)} onChange={onColor} />
      <div className="u-color-channels">
        {channelLabels(channel).map((lab, i) => (
          <Field key={i} label={lab} value={channelValues[i] ?? ''} onChange={(value) => setChannel(i, value)} />
        ))}
      </div>
      <Field label="A" value={String(Math.round(hsva.a * 100))} onChange={(value) => onNumber('a', value, 100)} />
    </div>
  );
}

function NotationRow({ notation }: { notation: Notation }) {
  const translate = useTranslate();
  const { asHex, channel, mode } = notation;
  return (
    <div className="u-color-modes">
      <button
        type="button"
        className={`u-color-mode is-hex ${asHex ? 'is-on' : ''}`}
        onClick={notation.chooseHex}
        aria-pressed={asHex}
        title={translate('styleModel.components.colorPicker.hexTitle')}
      >
        HEX
      </button>
      <button
        type="button"
        className={`u-color-mode is-channel ${asHex ? 'is-off' : ''}`}
        onClick={notation.toggleChannel}
        aria-pressed={!asHex}
        aria-label={translate('styleModel.components.colorPicker.channelLabel', { mode, other: channel === 'rgb' ? 'hsl' : 'rgb' })}
        title={translate('styleModel.components.colorPicker.channelTitle')}
      >
        {channelLabels(channel).map((lab, i) => (
          <span key={i}>{lab}</span>
        ))}
      </button>
      <span className="u-color-mode-static is-alpha">A</span>
    </div>
  );
}

function hueColorWithSat(hsva: HSVA): string {
  return formatHex({ ...hsvaToRgba({ ...hsva, a: 1 }), a: 1 });
}
