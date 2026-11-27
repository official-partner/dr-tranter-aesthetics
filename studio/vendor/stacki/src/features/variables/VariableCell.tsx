import React, { useContext, useEffect, useRef, useState } from 'react';
import type { VariableCell } from '../../ipc/variablesBridge';
import { VARIABLES_LIMITS } from '../../ipc/variablesBridge';
import { assert } from '../../../shared/core/assert';
import ColorSwatch from '../style/components/ColorSwatch';
import VariableConnect, { connectCustomField } from '../style/VariableConnect';
import EasingEditor, { MiniCurve } from '../style/EasingEditor';
import { easingToBezier, isEasing } from '../style/model/transition';
import { useTranslate } from '../../lib/i18n/useTranslate';
import FluidBadge from './FluidBadge';
import { VariablePreviewContext } from './liveVariableEdits';
import CustomValue, { doesNotFit, isLong, withBinding } from '../style/CustomValueEditor';

type CellValue = VariableCell & {
  readonly fluid?: React.ComponentProps<typeof FluidBadge>['fluid'];
};
type FluidReport = React.ComponentProps<typeof FluidBadge>['fluid'];
export interface VariableCellProps {
  readonly cell: CellValue | undefined;
  readonly onSave: (cell: VariableCell, value: string) => void | Promise<void>;
  readonly fluidOf?: ((cell: VariableCell) => FluidReport) | undefined;
  readonly onDraft?: ((name: string, value: string | undefined) => void) | undefined;
}
interface PopulatedCellProps extends Omit<VariableCellProps, 'cell'> {
  readonly cell: CellValue;
}
interface CurveFrame {
  readonly left: number;
  readonly width: number;
}
const SAVE_ON = ['Enter', 'Tab'];
let closeOpenCurve: (() => void) | undefined;

function reportSaveFailure(error: unknown): void {
  console.error('[stacki] variable save failed:', error);
}

export default function VariableCellEditor(props: VariableCellProps) {
  if (!props.cell) {
    return <div className="var-cell empty">—</div>;
  }
  return <PopulatedCell {...props} cell={props.cell} />;
}
function useVariableCell({ cell, onSave, fluidOf, onDraft }: PopulatedCellProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [custom, setCustom] = useState<DOMRect | undefined>(undefined);
  const [curve, setCurve] = useState<CurveFrame | undefined>(undefined);
  const value = draft ?? cell.value;
  assert(value.length <= VARIABLES_LIMITS.fileCharsMax, 'Variable cell: value limit exceeded');
  assert(cell.name.length <= VARIABLES_LIMITS.fileCharsMax, 'Variable cell: name limit exceeded');

  useEffect(() => setDraft((current) => (current === cell.value ? undefined : current)), [cell.value, cell.valueStart]);

  const preview = useContext(VariablePreviewContext);
  const previewed = useRef<string | undefined>(undefined);
  const cellRef = useRef(cell);
  cellRef.current = cell;
  useEffect(() => {
    if (draft === previewed.current) {
      return;
    }
    previewed.current = draft;
    preview?.(cellRef.current, draft);
  }, [draft, preview]);
  useEffect(
    () => () => {
      if (previewed.current !== undefined) {
        preview?.(cellRef.current, undefined);
      }
    },
    [preview],
  );

  useEffect(() => {
    if (!cell?.name) {
      return undefined;
    }
    onDraft?.(cell.name, draft);
    return () => onDraft?.(cell.name, undefined);
  }, [cell?.name, draft, onDraft]);

  const write = async (next: string) => {
    if (next === cell.value) {
      setDraft(undefined);
      return;
    }
    try {
      await onSave(cell, next);
    } finally {
      setDraft((current) => (current === next ? undefined : current));
    }
  };
  const commit = (next = value): void => {
    void write(next).catch(reportSaveFailure);
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (!curve) {
      return undefined;
    }
    closeOpenCurve?.();
    const close = () => {
      setCurve(undefined);
      commitRef.current();
    };
    closeOpenCurve = close;
    return () => {
      if (closeOpenCurve === close) {
        closeOpenCurve = undefined;
      }
    };
  }, [curve]);

  const isColor = !!cell.color || cell.unknownColor;

  const alwaysOwn = (target: EventTarget) => target instanceof Element && !!target.closest('.embed-editor_varconnect-dot, .u-color-swatch, .var-ease');

  const openCustom = (node: Element) => setCustom(node.getBoundingClientRect());

  return {
    cell,
    fluidOf,
    draft,
    setDraft,
    custom,
    setCustom,
    curve,
    setCurve,
    value,
    commit,
    isColor,
    alwaysOwn,
    openCustom,
  };
}

type CellState = ReturnType<typeof useVariableCell>;
function PopulatedCell(props: PopulatedCellProps) {
  const state = useVariableCell(props);
  return <CellView state={state} />;
}
function CellView({ state }: { readonly state: CellState }) {
  const { cell, fluidOf, custom, value, alwaysOwn, openCustom } = state;
  const arrowDown = useRef<React.KeyboardEvent | undefined>(undefined);
  return (
    <div
      className="var-cell"
      onMouseDownCapture={(event) => {
        if (custom || alwaysOwn(event.target)) {
          return;
        }
        if (!doesNotFit(event.currentTarget, value)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openCustom(event.currentTarget);
      }}
      onKeyUpCapture={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
          return;
        }
        const pressed = arrowDown.current;
        arrowDown.current = undefined;
        if (pressed?.isPropagationStopped() === true) {
          return;
        }
        if (state.draft !== undefined && state.draft !== cell.value) {
          state.commit(state.draft);
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          arrowDown.current = event;
        }
        if (event.key !== '=' || custom) {
          return;
        }
        event.preventDefault();
        openCustom(event.currentTarget);
      }}
    >
      {}
      <CellCurveButton state={state} />
      <CellCurveEditor state={state} />
      <CellColor state={state} />
      <CellInput state={state} />
      {}
      <CellFluidBadge report={fluidOf ? fluidOf(cell) : cell.fluid} />
      <CellCustomValue state={state} />
    </div>
  );
}
function CellFluidBadge({ report }: { readonly report: FluidReport }) {
  return <FluidBadge {...(report ? { fluid: report } : {})} />;
}
function CellCurveButton({ state }: { readonly state: CellState }) {
  const translate = useTranslate();
  const { cell, setCurve, value } = state;
  return (
    <>
      {isEasing(value) && (
        <button
          type="button"
          className="var-ease"
          title={translate('variables.cell.editCurve', { name: cell.name })}
          aria-label={translate('variables.cell.editCurve', { name: cell.name })}
          onClick={(event) => {
            const sheet = event.currentTarget.closest('.vars-view') || event.currentTarget.closest('.cms-view');
            const box = sheet?.getBoundingClientRect();
            setCurve(box?.width ? { left: box.left, width: box.width } : { left: 0, width: typeof window === 'undefined' ? 0 : window.innerWidth });
          }}
        >
          {}
          <MiniCurve b={easingToBezier(value)} />
        </button>
      )}
    </>
  );
}

function CellCurveEditor({ state }: { readonly state: CellState }) {
  const { setDraft, curve, setCurve, value, commit } = state;
  return (
    <>
      {curve && (
        <EasingEditor
          value={value}
          frame={curve}
          onChange={(timing) => setDraft(timing)}
          onClose={() => {
            setCurve(undefined);
            commit();
          }}
        />
      )}
    </>
  );
}

function CellColor({ state }: { readonly state: CellState }) {
  const translate = useTranslate();
  const { cell, setDraft, value, commit, isColor } = state;
  return (
    <>
      {isColor && (
        <ColorSwatch
          value={cell.color || cell.resolved || value}
          ariaLabel={translate('variables.cell.chooseColor', { name: cell.name })}
          onChange={(color, live) => {
            if (live) {
              setDraft(color);
            } else {
              commit(color);
            }
          }}
        />
      )}
    </>
  );
}

function CellCustomValue({ state }: { readonly state: CellState }) {
  const { cell, setDraft, custom, setCustom, value, commit } = state;
  return (
    <>
      {custom && (
        <CustomValue
          connectField={connectCustomField}
          value={value}
          label={cell.name}
          anchor={custom}
          onCancel={() => {
            setCustom(undefined);
            setDraft(undefined);
          }}
          onSave={(next) => {
            setCustom(undefined);
            commit(next);
          }}
        />
      )}
    </>
  );
}

function CellInput({ state }: { readonly state: CellState }) {
  const { cell, setDraft, custom, setCustom, value, commit } = state;
  return (
    <VariableConnect
      className="is-fill"
      code
      onPick={(binding) => commit(withBinding(value, binding))}
      onDraft={(next) => setDraft(next)}
    >
      <input
        maxLength={VARIABLES_LIMITS.fileCharsMax}
        className="var-input"
        value={value}
        spellCheck={false}
        title={`${cell.name}: ${cell.value}${cell.resolved ? `\n→ ${cell.resolved}` : ''}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!custom) {
            commit();
          }
        }}
        onFocus={(event) => {
          if (document.activeElement !== event.currentTarget) {
            return;
          }
          event.currentTarget.select();
        }}
        onMouseDown={(event) => {
          if (isLong(value)) {
            event.preventDefault();
            setCustom(event.currentTarget.getBoundingClientRect());
            return;
          }
          if (document.activeElement === event.currentTarget) {
            return;
          }
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          if (event.key === '=') {
            event.preventDefault();
            setCustom(event.currentTarget.getBoundingClientRect());
            return;
          }
          if (SAVE_ON.includes(event.key)) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(undefined);
          }
        }}
      />
    </VariableConnect>
  );
}
