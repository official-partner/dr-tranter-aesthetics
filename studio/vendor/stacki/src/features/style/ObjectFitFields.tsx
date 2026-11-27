import { centralIcon } from '../../ui/central/CentralIcon';
import { more as centralMore } from '../../ui/central/centralGeometry';

import { useEffect, useRef, useState } from 'react';
import PanelSheet from './components/PanelSheet';
import type { ReactNode } from 'react';
import FieldLabel from './components/FieldLabel';
import { PropTip } from './components/CssPropertyTip';
import { HoverTooltip } from '../../ui/SegmentedControl';
import type { SelectOption } from './components/Select';
import { VariableSelect } from './KeywordConnect';
import useScrub from './components/useScrub';
import VariableConnect from './VariableConnect';
import { splitTopLevelSpaces } from './model/background';
import { displayOf, type Display } from './model/styleDisplay';
import { type SetProp, type ClearProp, type LiveSetProp, type Props, SizeLabel, withImportant, useFollowingDraft, stepSizeKey } from './SizeKit';
import { RatioOtherInput } from './AspectRatioField';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { useHoverPreview } from './connectFieldHelpers';


export const FIT_OPTIONS: SelectOption<string>[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'none', label: 'None' },
  { value: 'scale-down', label: 'Scale Down' },
];
export const FIT_CUSTOM = '__custom__';

export const OBJECT_POSITION_PERCENTS = ['0%', '50%', '100%'];
export function objectPositionAxis(token: string): number {
  const normalized = token.trim().toLowerCase();
  if (normalized === '' || normalized === 'center' || normalized === '50%') {
    return 1;
  }
  if (normalized === 'left' || normalized === 'top' || normalized === '0' || normalized === '0%' || normalized === '0px') {
    return 0;
  }
  if (normalized === 'right' || normalized === 'bottom' || normalized === '100%') {
    return 2;
  }
  return -1;
}

export const DotsIcon = centralIcon(centralMore);

export function ObjectPositionInput({
  value,
  busy,
  label,
  onLive,
  onCommit,
}: {
  value: string;
  busy: boolean;
  label: string;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const translate = useTranslate();
  const { draft, setDraft, focused } = useFollowingDraft(value);
  const commitScrub = (text: string) => {
    setDraft(text);
    onCommit(asPositionOffset(text));
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: (text) => onLive(asPositionOffset(text)),
    onCommit: commitScrub,
  });
  return (
    <VariableConnect
      code
      ariaLabel={translate('style.objectFitFields.connect', { name: label })}
      disabled={busy}
      prop="object-position"
      canvasProperty="object-position"
      onPick={(binding) => onCommit(binding)}
    >
      <input
        {...scrub.input}
        className="u-input embed-editor_size-input"
        value={draft}
        placeholder="50%"
        aria-label={label}
        disabled={busy}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          onLive(asPositionOffset(event.target.value));
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          onCommit(asPositionOffset(draft));
        }}
        onKeyDown={(event) => {
          const stepped = stepSizeKey(event);
          if (stepped !== undefined) {
            setDraft(stepped);
            onLive(asPositionOffset(stepped));
          }
        }}
      />
    </VariableConnect>
  );
}

export function asPositionOffset(typed: string): string {
  const text = typed.trim();
  if (text === '') {
    return '';
  }
  return /^-?[\d.]+$/.test(text) ? `${text}%` : text;
}

export function PositionModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const translate = useTranslate();
  return (
    <PanelSheet
      className="embed-editor_bg-modal embed-editor_pos-modal u-surface-surface"
      label={translate('style.objectFitFields.objectPosition')}
      onClose={onClose}
    >
      {children}
    </PanelSheet>
  );
}

export function ImageFitField({ read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector }: Props) {
  const translate = useTranslate();
  const fit = displayOf(read('object-fit'));
  const positionDisplay = displayOf(read('object-position'));
  const [positionOpen, setPositionOpen] = useState(false);
  const positionRaw = positionDisplay.present ? positionDisplay.value.trim() : '';
  const positionSet = positionRaw !== '' && positionRaw.toLowerCase() !== 'unset';

  return (
    <>
      <div className="embed-editor_size-row">
        <SizeLabel
          label={translate('style.objectFitFields.imageFit')}
          prop="object-fit"
          display={fit}
          contributors={read('object-fit')?.contributors ?? []}
          busy={busy}
          onClear={() => clearProp('object-fit')}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
        <div className="embed-editor_imgfit-controls">
          <ObjectFitSelect fit={fit} busy={busy} setProp={setProp} clearProp={clearProp} liveSetProp={liveSetProp} />
          <ObjectPositionButton busy={busy} positionSet={positionSet} positionOpen={positionOpen} onToggle={() => setPositionOpen((open) => !open)} />
        </div>
      </div>
      {positionOpen ? (
        <PositionModal onClose={() => setPositionOpen(false)}>
          <ObjectPositionEditor
            positionRaw={positionRaw}
            positionSet={positionSet}
            busy={busy}
            setProp={setProp}
            clearProp={clearProp}
            liveSetProp={liveSetProp}
          />
        </PositionModal>
      ) : undefined}
    </>
  );
}

export function ObjectPositionButton({
  busy,
  positionSet,
  positionOpen,
  onToggle,
}: {
  busy: boolean;
  positionSet: boolean;
  positionOpen: boolean;
  onToggle: () => void;
}) {
  const translate = useTranslate();
  const moreRef = useRef<HTMLButtonElement>(null);
  const tip = useDelayedTip();
  return (
    <>
      <button
        ref={moreRef}
        type="button"
        className={'embed-editor_icon-btn embed-editor_imgfit-more ' + (positionSet ? 'is-active' : '')}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={positionOpen}
        aria-label={translate('style.objectFitFields.positionSettings')}
        onClick={() => {
          tip.end();
          onToggle();
        }}
        onMouseEnter={tip.start}
        onMouseLeave={tip.end}
      >
        <DotsIcon />
      </button>
      {tip.open && moreRef.current && !positionOpen ? (
        <HoverTooltip anchor={moreRef.current}>{translate('style.objectFitFields.positionSettings')}</HoverTooltip>
      ) : undefined}
    </>
  );
}

export function useDelayedTip() {
  const [open, setOpen] = useState(false);
  const tipTimer = useRef<number | undefined>(undefined);
  const clearTip = () => {
    if (tipTimer.current !== undefined) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = undefined;
    }
  };
  useEffect(() => clearTip, []);
  const start = () => {
    clearTip();
    tipTimer.current = window.setTimeout(() => {
      tipTimer.current = undefined;
      setOpen(true);
    }, 400);
  };
  const end = () => {
    clearTip();
    setOpen(false);
  };
  return { open, start, end };
}

export function ObjectFitSelect({
  fit,
  busy,
  setProp,
  clearProp,
  liveSetProp,
}: {
  fit: Display;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
}) {
  const hoverPreview = useHoverPreview();
  const translate = useTranslate();
  const [forceCustom, setForceCustom] = useState(false);
  const fitValue = fit.value.trim().toLowerCase();
  const knownFit = FIT_OPTIONS.some((option) => option.value === fitValue);
  const fitCustom = forceCustom || (fit.present && fitValue !== '' && !knownFit) || fit.important;
  const askedForCustom = useRef(false);
  const pickFit = (choice: string) => {
    if (choice === FIT_CUSTOM) {
      setForceCustom(true);
      askedForCustom.current = true;
      setProp('object-fit', 'unset', false);
      return;
    }
    askedForCustom.current = false;
    setForceCustom(false);
    setProp('object-fit', choice, false);
  };
  return (
    <VariableSelect
      prop="object-fit"
      rawValue={fit.present ? fit.value : ''}
      onVariable={(binding) => {
        askedForCustom.current = false;
        setForceCustom(false);
        setProp('object-fit', binding, fit.important);
      }}
      className="embed-editor_imgfit-select"
      value={fitCustom ? FIT_CUSTOM : fit.present ? fitValue : 'fill'}
      options={[...FIT_OPTIONS, { value: FIT_CUSTOM, label: translate('style.objectFitFields.custom') }]}
      ariaLabel={translate('style.objectFitFields.objectFit')}
      disabled={busy}
      onChange={pickFit}
      onPreview={(choice) => hoverPreview('object-fit', choice === FIT_CUSTOM ? undefined : (choice ?? undefined), false)}
      customInput={
        fitCustom ? (
          <RatioOtherInput
            value={fit.present ? withImportant(fit) : ''}
            busy={busy}
            prop="object-fit"
            autoFocus={askedForCustom.current}
            ariaLabel={translate('style.objectFitFields.objectFitValue')}
            onCommit={(value, important) => setProp('object-fit', value, important)}
            onLiveCommit={(value, important) => liveSetProp('object-fit', value, important)}
            onClear={() => {
              setForceCustom(false);
              clearProp('object-fit');
            }}
          />
        ) : undefined
      }
    />
  );
}

export function ObjectPositionEditor({
  positionRaw,
  positionSet,
  busy,
  setProp,
  clearProp,
  liveSetProp,
}: {
  positionRaw: string;
  positionSet: boolean;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
}) {
  const translate = useTranslate();
  const positionParts = splitTopLevelSpaces(positionRaw).filter(Boolean);
  const left = positionParts[0] ?? '';
  const top = positionParts[1] ?? '';
  const writePosition = (value: string, mode: 'live' | 'commit') => {
    if (mode === 'live') {
      if (value) {
        liveSetProp('object-position', value, false);
      }
      return;
    }
    if (value) {
      setProp('object-position', value, false);
    } else {
      clearProp('object-position');
    }
  };
  return (
    <div className="embed-editor_imgfit-pos">
      <FieldLabel
        className="embed-editor_imgfit-pos-label"
        active={positionSet}
        disabled={busy}
        onReset={() => clearProp('object-position')}
        resetLabel={translate('style.objectFitFields.clear')}
        tooltip={<PropTip props={['object-position']} />}
      >
        {translate('style.objectFitFields.position')}
      </FieldLabel>
      <div className="embed-editor_bg-position">
        <ObjectPositionGrid
          activeColumn={objectPositionAxis(left)}
          activeRow={objectPositionAxis(top)}
          busy={busy}
          onPick={(value) => writePosition(value, 'commit')}
        />
        {}
        <ObjectPositionFields left={left} top={top} busy={busy} writePosition={writePosition} />
      </div>
    </div>
  );
}

export function ObjectPositionFields({
  left,
  top,
  busy,
  writePosition,
}: {
  left: string;
  top: string;
  busy: boolean;
  writePosition: (value: string, mode: 'live' | 'commit') => void;
}) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_bg-posfields">
      <div className="embed-editor_bg-posfield">
        <span className="embed-editor_bg-posfield-cap">{translate('style.objectFitFields.left')}</span>
        <ObjectPositionInput
          value={left}
          busy={busy}
          label={translate('style.objectFitFields.positionLeft')}
          onLive={(value) => writePosition(`${value || '50%'} ${top || '50%'}`, 'live')}
          onCommit={(value) => writePosition(value || top ? `${value || '50%'} ${top || '50%'}` : '', 'commit')}
        />
      </div>
      <div className="embed-editor_bg-posfield">
        <span className="embed-editor_bg-posfield-cap">{translate('style.objectFitFields.top')}</span>
        <ObjectPositionInput
          value={top}
          busy={busy}
          label={translate('style.objectFitFields.positionTop')}
          onLive={(value) => writePosition(`${left || '50%'} ${value || '50%'}`, 'live')}
          onCommit={(value) => writePosition(left || value ? `${left || '50%'} ${value || '50%'}` : '', 'commit')}
        />
      </div>
    </div>
  );
}

export function ObjectPositionGrid({
  activeColumn,
  activeRow,
  busy,
  onPick,
}: {
  activeColumn: number;
  activeRow: number;
  busy: boolean;
  onPick: (value: string) => void;
}) {
  const translate = useTranslate();
  const columnLabels = [
    translate('style.objectFitFields.cellLeft'),
    translate('style.objectFitFields.cellCenter'),
    translate('style.objectFitFields.cellRight'),
  ];
  const rowLabels = [translate('style.objectFitFields.cellTop'), translate('style.objectFitFields.cellMiddle'), translate('style.objectFitFields.cellBottom')];
  return (
    <div className="embed-editor_bg-posgrid" role="group" aria-label={translate('style.objectFitFields.positionPreset')}>
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((column) => (
          <button
            key={`${row}-${column}`}
            type="button"
            className={'embed-editor_bg-poscell ' + (activeColumn === column && activeRow === row ? 'is-active' : '')}
            disabled={busy}
            aria-label={translate('style.objectFitFields.positionCell', { horizontal: columnLabels[column] ?? '', vertical: rowLabels[row] ?? '' })}
            onClick={() => onPick(`${OBJECT_POSITION_PERCENTS[column]} ${OBJECT_POSITION_PERCENTS[row]}`)}
          />
        )),
      )}
    </div>
  );
}
