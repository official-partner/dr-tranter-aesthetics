import { useRef, useState } from 'react';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from './Icons';
import useDismiss from './useDismiss';
import {
  CLOCK_HOURS,
  CLOCK_MINUTES,
  clockHour,
  dayHour,
  formatPicked,
  longDay,
  localValue,
  monthGrid,
  monthName,
  monthOf,
  parseLocalValue,
  parseTyped,
  shiftMonth,
  today,
  type CalendarMonth,
  type LocalDateTime,
  type Meridiem,
  type PickerMode,
  weekdayLabels,
} from './dateTimePickerModel';
import { useLocale, useTranslate } from '../lib/i18n/useTranslate';
import './dateTimePicker.css';

interface Props {
  readonly mode: PickerMode;
  readonly value: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
}

type Tab = 'date' | 'time';

const NOON = 12;

export default function DateTimePicker(props: Props) {
  const { mode, value } = props;
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('date');
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const picked = pickedOf(mode, value);
  const [shown, setShown] = useState<CalendarMonth>(() => monthOf(picked?.day ?? today()));
  useDismiss(root, { active: open }, () => setOpen(false));
  const commit = (next: string) => {
    setDraft(undefined);
    if (next !== value) {
      props.onChange(next);
    }
  };
  const pickDay = (day: string) => {
    if (mode === 'date') {
      commit(day);
      setOpen(false);
      return;
    }
    commit(localValue({ day, hour: picked?.hour ?? NOON, minute: picked?.minute ?? 0 }));
    setTab('time');
  };
  const pickTime = (hour: number, minute: number) => commit(localValue({ day: picked?.day ?? today(), hour, minute }));
  const toggle = () => {
    setShown(monthOf(picked?.day ?? today()));
    setTab('date');
    setOpen(!open);
  };
  return (
    <div ref={root} className="date-time-picker" onKeyDown={(event) => event.key === 'Escape' && open && setOpen(false)}>
      <PickerControl {...props} draft={draft} open={open} onDraft={setDraft} onCommit={commit} onToggle={toggle} />
      {open && (
        <div className="date-time-popover" role="dialog" aria-label={props.label}>
          {tab === 'date' ? (
            <CalendarPane shown={shown} selected={picked?.day} onShow={setShown} onPick={pickDay} />
          ) : (
            <TimePane picked={picked} onPick={pickTime} />
          )}
          {mode === 'datetime' && <PickerTabs tab={tab} onTab={setTab} />}
        </div>
      )}
    </div>
  );
}

function PickerControl(
  props: Props & {
    readonly draft: string | undefined;
    readonly open: boolean;
    readonly onDraft: (draft: string | undefined) => void;
    readonly onCommit: (value: string) => void;
    readonly onToggle: () => void;
  },
) {
  const translate = useTranslate();
  const commitDraft = () => {
    if (props.draft === undefined) {
      return;
    }
    const parsed = parseTyped(props.mode, props.draft);
    if (parsed === undefined) {
      props.onDraft(undefined);
    } else {
      props.onCommit(parsed);
    }
  };
  return (
    <div className={`date-time-control ${props.open ? 'open' : ''}`}>
      <button
        type="button"
        className="date-time-open"
        aria-label={translate('ui.dateTime.choose', { label: props.label })}
        aria-expanded={props.open}
        title={translate(props.mode === 'date' ? 'ui.dateTime.openCalendar' : 'ui.dateTime.openCalendarClock')}
        onClick={props.onToggle}
      >
        <CalendarIcon size={13} />
      </button>
      <input
        aria-label={props.label}
        value={props.draft ?? formatPicked(props.mode, props.value)}
        placeholder={props.mode === 'date' ? 'MM/DD/YYYY' : 'MM/DD/YYYY hh:mm AM'}
        spellCheck={false}
        onChange={(event) => props.onDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitDraft();
          }
        }}
      />
    </div>
  );
}

function CalendarPane(props: {
  readonly shown: CalendarMonth;
  readonly selected: string | undefined;
  readonly onShow: (month: CalendarMonth) => void;
  readonly onPick: (day: string) => void;
}) {
  const translate = useTranslate();
  const { locale } = useLocale();
  const now = today();
  return (
    <div className="date-time-calendar">
      <div className="date-time-month">
        <button type="button" aria-label={translate('ui.dateTime.previousMonth')} onClick={() => props.onShow(shiftMonth(props.shown, -1))}>
          <ChevronLeftIcon size={14} />
        </button>
        <span aria-live="polite">
          <strong>{monthName(props.shown.month, locale)}</strong> {props.shown.year}
        </span>
        <button type="button" aria-label={translate('ui.dateTime.nextMonth')} onClick={() => props.onShow(shiftMonth(props.shown, 1))}>
          <ChevronRightIcon size={14} />
        </button>
      </div>
      <div className="date-time-days" role="grid">
        {weekdayLabels(locale).map((weekday) => (
          <span key={weekday} className="date-time-weekday" role="columnheader">
            {weekday}
          </span>
        ))}
        {monthGrid(props.shown).map((cell) => (
          <button
            key={cell.day}
            type="button"
            role="gridcell"
            aria-selected={cell.day === props.selected}
            className={dayClass({
              outside: cell.outside,
              selected: cell.day === props.selected,
              current: cell.day === now,
            })}
            onClick={() => props.onPick(cell.day)}
          >
            {cell.date}
          </button>
        ))}
      </div>
      {}
      <div className="date-time-footer">
        <span className="date-time-chosen">{props.selected === undefined ? translate('ui.dateTime.noDate') : longDay(props.selected, locale)}</span>
        <button type="button" className="date-time-today" title={translate('ui.dateTime.goToToday')} onClick={() => props.onPick(now)}>
          {translate('ui.dateTime.today')}
        </button>
      </div>
    </div>
  );
}

function TimePane(props: { readonly picked: LocalDateTime | undefined; readonly onPick: (hour: number, minute: number) => void }) {
  const translate = useTranslate();
  const hour = props.picked?.hour ?? NOON;
  const minute = props.picked?.minute ?? 0;
  const clock = clockHour(hour);
  const set = props.picked !== undefined;
  return (
    <div className="date-time-clock">
      <span className="date-time-heading">{translate('ui.dateTime.hour')}</span>
      <div className="date-time-grid">
        {CLOCK_HOURS.map((option) => (
          <button
            key={option}
            type="button"
            className={set && option === clock.hour ? 'on' : ''}
            onClick={() => props.onPick(dayHour(option, clock.meridiem), minute)}
          >
            {option}
          </button>
        ))}
      </div>
      <span className="date-time-heading">{translate('ui.dateTime.minute')}</span>
      <div className="date-time-grid">
        {CLOCK_MINUTES.map((option) => (
          <button key={option} type="button" className={set && option === minute ? 'on' : ''} onClick={() => props.onPick(hour, option)}>
            :{String(option).padStart(2, '0')}
          </button>
        ))}
      </div>
      <div className="date-time-meridiem">
        {(['AM', 'PM'] as const satisfies readonly Meridiem[]).map((option) => (
          <button
            key={option}
            type="button"
            className={set && option === clock.meridiem ? 'on' : ''}
            onClick={() => props.onPick(dayHour(clock.hour, option), minute)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function PickerTabs(props: { readonly tab: Tab; readonly onTab: (tab: Tab) => void }) {
  const translate = useTranslate();
  return (
    <div className="date-time-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={props.tab === 'date'} onClick={() => props.onTab('date')}>
        <CalendarIcon size={14} /> {translate('ui.dateTime.tabDate')}
      </button>
      <button type="button" role="tab" aria-selected={props.tab === 'time'} onClick={() => props.onTab('time')}>
        <ClockIcon size={14} /> {translate('ui.dateTime.tabTime')}
      </button>
    </div>
  );
}

function pickedOf(mode: PickerMode, value: string): LocalDateTime | undefined {
  if (mode === 'datetime') {
    return parseLocalValue(value);
  }
  const typed = parseTyped('date', value);
  return typed ? { day: typed, hour: NOON, minute: 0 } : undefined;
}

function dayClass(state: { readonly outside: boolean; readonly selected: boolean; readonly current: boolean }): string {
  return ['date-time-day', state.outside ? 'outside' : '', state.selected ? 'on' : '', state.current ? 'today' : ''].join(' ');
}
