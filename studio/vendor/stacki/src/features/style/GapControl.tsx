import { centralIcon } from '../../ui/central/CentralIcon';
import { lock as centralLock, unlock as centralUnlock } from '../../ui/central/centralGeometry';
import { useEffect, useRef, useState } from 'react';
import { GroupLabel, PropLabel } from './TypographySection';
import { displayOf, parseImportant, withImportant } from './model/styleDisplay';
import useScrub from './components/useScrub';
import { handleArrowStep } from './model/numberStep';
import { isNonNegative } from './model/cssProperties';
import VariableConnect from './VariableConnect';
import type { ResolvedProp } from './model/resolved';
import { splitTopLevelSpaces } from './model/background';
import { useGapHover, type GapAxis } from './model/gapHover';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { commitInPlace } from './model/commitStyleInPlace';


type SetProp = (prop: string, value: string, important: boolean) => void;
type ClearProp = (prop: string | string[]) => void;
type LiveSetProp = (prop: string, value: string | undefined, important: boolean) => void;

const ROW = 'row-gap';
const COL = 'column-gap';
const ROW_LEGACY = 'grid-row-gap';
const COL_LEGACY = 'grid-column-gap';
const SHORTHAND = 'gap';
const GAP_PROPS = [ROW, COL, ROW_LEGACY, COL_LEGACY, SHORTHAND];

function shorthandPart(value: string, axis: 'row' | 'col'): string {
  const parts = splitTopLevelSpaces(value).filter(Boolean);
  if (!parts.length) {
    return '';
  }
  return axis === 'row' ? (parts[0] ?? '') : (parts[1] ?? parts[0] ?? '');
}

type Axis = {
  value: string;
  important: boolean;
  text: string;
  targets: string[];
  resolved: ResolvedProp | undefined;
};

function axisState(modern: string, legacy: string, axis: 'row' | 'col', read: (prop: string) => ResolvedProp | undefined): Axis {
  const modernResolved = read(modern);
  const legacyResolved = read(legacy);
  const modernSet = modernResolved?.source === 'selected';
  const legacySet = legacyResolved?.source === 'selected';
  const targets: string[] = [];
  if (modernSet) {
    targets.push(modern);
  }
  if (legacySet) {
    targets.push(legacy);
  }
  const own = legacySet ? legacyResolved : modernSet ? modernResolved : undefined;
  const effective = own ?? legacyResolved ?? modernResolved;
  if (effective) {
    const raw = rawEffective(effective);
    return { value: raw.value, important: raw.important, text: withImportant(raw), targets, resolved: effective };
  }
  const short = read(SHORTHAND);
  if (short) {
    const raw = rawEffective(short);
    const part = shorthandPart(raw.value, axis);
    return {
      value: part,
      important: raw.important,
      text: withImportant({ value: part, important: raw.important }),
      targets,
      resolved: short,
    };
  }
  return { value: '', important: false, text: '', targets, resolved: undefined };
}

function rawEffective(resolved: ResolvedProp | undefined): { value: string; important: boolean } {
  if (!resolved) {
    return { value: '', important: false };
  }
  const effective = resolved.source === 'selected' && resolved.selectedValue ? resolved.selectedValue : resolved.winner;
  return { value: effective.value, important: effective.important };
}

const LockedIcon = centralIcon(centralLock);
const UnlockedIcon = centralIcon(centralUnlock);

function axesFor(prop: string, layout: 'linked' | 'split'): GapAxis[] {
  if (layout === 'linked') {
    return ['row', 'column'];
  }
  return prop === COL ? ['column'] : ['row'];
}

interface GapFieldOptions {
  prop: string;
  value: string;
  busy: boolean;
  axes: GapAxis[];
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
}

function GapInput({
  ariaLabel,
  ...field
}: GapFieldOptions & {
  ariaLabel: string;
}) {
  const translate = useTranslate();
  const inputProps = useGapField(field);
  return (
    <VariableConnect
      code
      {...(isNonNegative(field.prop) ? { stepMin: 0 } : {})}
      className="is-fill"
      ariaLabel={translate('style.gapControl.connect', { name: ariaLabel })}
      disabled={field.busy}
      prop={field.prop}
      canvasProperty={field.prop}
      onPick={(binding) => field.onCommit(binding)}
    >
      <input {...inputProps} className="u-input embed-editor_size-input" disabled={field.busy} spellCheck={false} placeholder="0" aria-label={ariaLabel} />
    </VariableConnect>
  );
}

function useGapField({ prop, value, busy, axes, onLive, onCommit }: GapFieldOptions) {
  const { draft, setDraft, focused } = useExternalDraft(value);
  const { scheduleLive, cancelLive } = useLiveTimer(onLive);
  const gapHover = useGapHover(axes, draft || value);
  const commitScrub = (text: string) => {
    setDraft(text);
    onCommit(text);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: onLive,
    onCommit: commitScrub,
  });
  return {
    ...scrub.input,
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value);
      scheduleLive(event.target.value);
      gapHover.onValue(event.target.value);
    },
    ...gapHover.handlers,
    onFocus: () => {
      focused.current = true;
      gapHover.onFocus();
    },
    onBlur: () => {
      focused.current = false;
      gapHover.onBlur();
      cancelLive();
      onCommit(draft);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      const stepped = stepOnKey(event, prop);
      if (stepped !== undefined) {
        setDraft(stepped);
        scheduleLive(stepped);
      }
    },
  };
}

function useExternalDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);
  return { draft, setDraft, focused };
}

function stepOnKey(event: React.KeyboardEvent<HTMLInputElement>, prop: string) {
  if (event.key === 'Enter') {
    commitInPlace(event.currentTarget);
    return undefined;
  }
  const stepped = handleArrowStep(event, isNonNegative(prop) ? 0 : undefined);
  if (!stepped) {
    return undefined;
  }
  event.preventDefault();
  const input = event.currentTarget;
  input.value = stepped.text;
  input.setSelectionRange(stepped.caret, stepped.caret);
  return stepped.text;
}

function useLiveTimer(onLive: (value: string) => void) {
  const liveTimer = useRef<number | undefined>(undefined);
  const cancelLive = () => {
    if (liveTimer.current !== undefined) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
    }
  };
  useEffect(() => cancelLive, []);
  const scheduleLive = (text: string) => {
    cancelLive();
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined;
      onLive(text);
    }, 100);
  };
  return { scheduleLive, cancelLive };
}

interface GapControlProps {
  show: boolean;
  read: (prop: string) => ResolvedProp | undefined;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}

interface WriteOptions {
  readonly live: boolean;
}

export default function GapControl(props: GapControlProps) {
  const { show, read, busy, setProp, clearProp, liveSetProp } = props;
  const translate = useTranslate();
  const rowAxis = axisState(ROW, ROW_LEGACY, 'row', read);
  const columnAxis = axisState(COL, COL_LEGACY, 'col', read);
  const row = rowAxis.text;
  const column = columnAxis.text;
  const [linkOverride, setLinkOverride] = useState<boolean | undefined>(undefined);
  const linked = linkOverride ?? row === column;

  if (!show) {
    return undefined;
  }

  const writeAxis = axisWriter({ setProp, liveSetProp, clearProp });
  const writeBoth = (next: string, options: WriteOptions) => {
    writeAxis(rowAxis, ROW, next, options);
    writeAxis(columnAxis, COL, next, options);
  };
  const toggleLink = () => {
    setLinkOverride(!linked);
    if (linked) {
      return;
    }
    const single = row || column;
    if (single) {
      writeBoth(single, { live: false });
    } else {
      clearProp(GAP_PROPS);
    }
  };
  const { onProvenance, onSelectSelector } = props;
  const labelProps = { busy, onProvenance, onSelectSelector };

  return (
    <div className="embed-editor_size-row">
      <GroupLabel
        label={translate('style.gapControl.gap')}
        props={GAP_PROPS}
        read={read}
        {...labelProps}
        onClear={() => {
          setLinkOverride(undefined);
          clearProp(GAP_PROPS);
        }}
      />
      <div className="embed-editor_gap">
        {linked ? (
          <GapInput
            prop={ROW}
            value={row}
            busy={busy}
            ariaLabel={translate('style.gapControl.gap')}
            axes={axesFor(ROW, 'linked')}
            onLive={(next) => writeBoth(next, { live: true })}
            onCommit={(next) => writeBoth(next, { live: false })}
          />
        ) : (
          <SplitGapFields rowAxis={rowAxis} columnAxis={columnAxis} {...labelProps} clearProp={clearProp} writeAxis={writeAxis} />
        )}
        <GapLinkButton linked={linked} busy={busy} onToggle={toggleLink} />
      </div>
    </div>
  );
}

function axisWriter({ setProp, liveSetProp, clearProp }: Pick<GapControlProps, 'setProp' | 'liveSetProp' | 'clearProp'>) {
  return (axis: Axis, fallback: string, next: string, options: WriteOptions) => {
    const trimmed = next.trim();
    const targets = axis.targets.length ? axis.targets : [fallback];
    if (!trimmed) {
      if (!options.live) {
        clearProp(targets);
      }
      return;
    }
    const parsed = parseImportant(trimmed);
    const put = options.live ? liveSetProp : setProp;
    targets.forEach((prop) => put(prop, parsed.value, parsed.important));
  };
}

function SplitGapFields({
  rowAxis,
  columnAxis,
  writeAxis,
  ...shared
}: Pick<GapControlProps, 'busy' | 'clearProp' | 'onProvenance' | 'onSelectSelector'> & {
  rowAxis: Axis;
  columnAxis: Axis;
  writeAxis: ReturnType<typeof axisWriter>;
}) {
  const translate = useTranslate();
  return (
    <>
      <GapCell
        axis={columnAxis}
        prop={COL}
        legacy={COL_LEGACY}
        label={translate('style.gapControl.columns')}
        ariaLabel={translate('style.gapControl.columnGap')}
        {...shared}
        write={(next, options) => writeAxis(columnAxis, COL, next, options)}
      />
      <GapCell
        axis={rowAxis}
        prop={ROW}
        legacy={ROW_LEGACY}
        label={translate('style.gapControl.rows')}
        ariaLabel={translate('style.gapControl.rowGap')}
        {...shared}
        write={(next, options) => writeAxis(rowAxis, ROW, next, options)}
      />
    </>
  );
}

function GapCell({
  axis,
  prop,
  legacy,
  label,
  ariaLabel,
  busy,
  clearProp,
  write,
  onProvenance,
  onSelectSelector,
}: Pick<GapControlProps, 'busy' | 'clearProp' | 'onProvenance' | 'onSelectSelector'> & {
  axis: Axis;
  prop: string;
  legacy: string;
  label: string;
  ariaLabel: string;
  write: (next: string, options: WriteOptions) => void;
}) {
  const resolved = axis.resolved;
  return (
    <div className="embed-editor_gap-cell">
      <GapInput
        prop={prop}
        value={axis.text}
        busy={busy}
        ariaLabel={ariaLabel}
        axes={axesFor(prop, 'split')}
        onLive={(next) => write(next, { live: true })}
        onCommit={(next) => write(next, { live: false })}
      />
      <PropLabel
        label={label}
        prop={prop}
        display={displayOf(resolved)}
        contributors={resolved?.contributors ?? []}
        busy={busy}
        onClear={() => clearProp(axis.targets.length ? axis.targets : [prop, legacy])}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
    </div>
  );
}

function GapLinkButton({ linked, busy, onToggle }: { linked: boolean; busy: boolean; onToggle: () => void }) {
  const translate = useTranslate();
  return (
    <button
      type="button"
      className={`embed-editor_icon-btn embed-editor_gap-link ${linked ? 'is-active' : ''}`}
      disabled={busy}
      aria-pressed={linked}
      title={linked ? translate('style.gapControl.linked') : translate('style.gapControl.unlinked')}
      onClick={onToggle}
    >
      {linked ? <LockedIcon /> : <UnlockedIcon />}
    </button>
  );
}
