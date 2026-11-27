
import { useEffect, useRef, useState } from 'react';
import { HoverTooltip } from '../../ui/SegmentedControl';
import type { ProjectVariable } from './model/webflow';
import { type ResolvedProp } from './model/resolved';
import { type SetProp, type ClearProp, type LiveSetProp, type Read, type Side, displayOf, isWrappedValue } from './spacingTypes';
import { siblingProps, useSideDrag, useSideHover } from './SpacingFill';
import { withImportant } from './spacingValue';
import { parseImportant } from './model/styleDisplay';
import { ImportantBadge } from './components/ImportantMark';
import { useStyleHint } from './model/computedStyle';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';

export function labelFor(value: string, empty: string): string {
  const text = value.trim().replace(/\s*!important$/i, '');
  return text || empty;
}

export function variableFor(value: string, variables: ProjectVariable[]): ProjectVariable | undefined {
  const raw = value.trim().replace(/\s*!important$/i, '');
  const binding = raw.match(/var\(\s*--[A-Za-z0-9_-]+[^)]*\)/i)?.[0];
  if (binding) {
    return binding === raw ? variables.find((variable) => variable.binding === binding) : undefined;
  }
  return variables.find((variable) => {
    const fullName = variable.group ? `${variable.group}/${variable.name}` : variable.name;
    return raw === fullName || raw === variable.name;
  });
}

const SIDE_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  'margin-top': 'style.spacingLabel.marginTop',
  'margin-right': 'style.spacingLabel.marginRight',
  'margin-bottom': 'style.spacingLabel.marginBottom',
  'margin-left': 'style.spacingLabel.marginLeft',
  'padding-top': 'style.spacingLabel.paddingTop',
  'padding-right': 'style.spacingLabel.paddingRight',
  'padding-bottom': 'style.spacingLabel.paddingBottom',
  'padding-left': 'style.spacingLabel.paddingLeft',
  top: 'style.spacingLabel.top',
  right: 'style.spacingLabel.right',
  bottom: 'style.spacingLabel.bottom',
  left: 'style.spacingLabel.left',
};

export function humanLabel(prop: string, translate: Translator): string {
  const key = SIDE_LABEL_KEYS[prop];
  if (key !== undefined) {
    return translate(key);
  }
  const spaced = prop.replace('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function SpacingLabel(props: SpacingLabelProps) {
  const { prop, side, read, busy, clearProp, onEdit } = props;
  const computed = useStyleHint(read(prop) === undefined ? prop : '');
  const look = labelLook({
    resolved: read(prop),
    override: props.override,
    emptyLabel: computed || props.emptyLabel,
    variableLabels: props.variableLabels ?? false,
    variables: props.variables,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltip = useLabelTooltip({ hasValue: look.hasValue });
  const gesture = useLabelGesture(props);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`embed-editor_spacing-label embed-editor_spacing-${side} ${look.state}`}
        data-prop={prop}
        disabled={busy}
        onMouseEnter={tooltip.open}
        onMouseLeave={tooltip.close}
        onPointerEnter={gesture.hover.onEnter(side)}
        onPointerLeave={gesture.hover.onLeave}
        onFocus={tooltip.show}
        onBlur={tooltip.close}
        onPointerDown={(event) => {
          tooltip.close();
          gesture.onPointerDown(side)(event);
        }}
        onPointerMove={(event) => {
          gesture.hover.onOver(event);
          gesture.onPointerMove(event);
        }}
        onPointerUp={gesture.onPointerUp}
        onPointerCancel={gesture.onPointerUp}
        onClick={(event) => {
          tooltip.close();
          if (gesture.wasDrag()) {
            return;
          }
          if (event.altKey) {
            clearProp(prop);
            return;
          }
          onEdit(prop, side);
        }}
      >
        {look.text}
        {look.important ? <ImportantBadge /> : undefined}
      </button>
      {tooltip.shown && look.hasValue && buttonRef.current ? <SpacingLabelTooltip anchor={buttonRef.current} look={look} /> : undefined}
    </>
  );
}

export function SpacingLabelTooltip({ anchor, look }: { anchor: HTMLElement; look: { variableFullName: string; tooltipContent: string } }) {
  return (
    <HoverTooltip anchor={anchor}>
      <span className="embed-editor_spacing-tooltip">
        <span className={look.variableFullName ? 'embed-editor_spacing-tooltip-meta' : 'embed-editor_spacing-tooltip-value'}>{look.tooltipContent}</span>
      </span>
    </HoverTooltip>
  );
}

export function useLabelGesture({
  prop,
  side,
  read,
  busy,
  setProp,
  liveSetProp,
  onLive,
  onLiveEnd,
}: Pick<SpacingLabelProps, 'prop' | 'side' | 'read' | 'busy' | 'setProp' | 'liveSetProp' | 'onLive' | 'onLiveEnd'>) {
  const propForSide = (other: Side) => siblingProps(prop, side, [other])[0] ?? prop;
  const kind = prop.startsWith('padding') ? 'padding' : 'margin';
  const drag = useSideDrag({
    propFor: propForSide,
    inward: prop.startsWith('padding'),
    kind,
    read,
    busy,
    setProp,
    liveSetProp,
    onLive,
    onLiveEnd,
    threshold: 3,
  });
  const hover = useSideHover({ propFor: propForSide, kind, read });
  return { ...drag, hover };
}

export type SpacingLabelProps = {
  prop: string;
  side: Side;
  override?: string | undefined;
  emptyLabel: string;
  read: Read;
  busy: boolean;
  clearProp: ClearProp;
  onEdit: (prop: string, side: Side) => void;
  variables: ProjectVariable[];
  variableLabels?: boolean;
  setProp: SetProp;
  liveSetProp: LiveSetProp;
  onLive: (props: string[], display: string) => void;
  onLiveEnd: () => void;
};

export function labelLook({
  resolved,
  override,
  emptyLabel,
  variableLabels,
  variables,
}: {
  resolved: ResolvedProp | undefined;
  override: string | undefined;
  emptyLabel: string;
  variableLabels: boolean;
  variables: ProjectVariable[];
}) {
  const display = displayOf(resolved);
  const value = override ?? (display.present ? withImportant(display) : '');
  const hasWrappedValue = isWrappedValue(value) || isWrappedValue(resolved?.winner.value);
  const overridden = override === undefined && display.overridden && !hasWrappedValue;
  const selected = override !== undefined || (display.present && display.isSelected);
  const color = selected ? 'is-selected' : display.present ? 'is-other' : '';
  const variable = override === undefined && variableLabels && !hasWrappedValue ? variableFor(value, variables) : undefined;
  const state = `${color}${variable ? ' is-variable' : ''}${overridden ? ' is-overridden' : ''}`;
  const variableFullName = variable ? (variable.group ? `${variable.group}/${variable.name}` : variable.name) : '';
  const important = parseImportant(value).important;
  const tooltipValue = variable ? variable.name : withImportant({ value: labelFor(value, emptyLabel), important });
  const tooltipContent = variableFullName || (overridden ? `Overridden by ${display.winnerSelector}` : tooltipValue);
  const hasValue = override !== undefined || display.present;
  const text = variable?.name ?? labelFor(value, emptyLabel);
  return { state, variableFullName, tooltipContent, hasValue, text, important };
}

export function useLabelTooltip({ hasValue }: { hasValue: boolean }) {
  const [shown, setShown] = useState(false);
  const tooltipTimer = useRef<number | undefined>(undefined);
  const clearTooltipTimer = () => {
    if (tooltipTimer.current !== undefined) {
      window.clearTimeout(tooltipTimer.current);
      tooltipTimer.current = undefined;
    }
  };
  useEffect(() => clearTooltipTimer, []);
  return {
    shown,
    open: () => {
      clearTooltipTimer();
      if (!hasValue) {
        return;
      }
      tooltipTimer.current = window.setTimeout(() => {
        tooltipTimer.current = undefined;
        setShown(true);
      }, 350);
    },
    show: () => {
      if (hasValue) {
        setShown(true);
      }
    },
    close: () => {
      clearTooltipTimer();
      setShown(false);
    },
  };
}
