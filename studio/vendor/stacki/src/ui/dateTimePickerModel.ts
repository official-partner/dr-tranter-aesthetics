import { assert } from '../../shared/core/assert';
import { formattersFor } from '../../shared/core/i18n/format';
import type { Locale } from '../../shared/core/i18n/locales';
import { validCalendarDay } from './dateFieldModel';

export const DATE_TIME_PICKER_LIMITS = {
  gridCells: 42,
  typedCharsMax: 40,
  yearMin: 1,
  yearMax: 9999,
  minuteStep: 5,
} as const;

export type PickerMode = 'date' | 'datetime';
export type Meridiem = 'AM' | 'PM';

export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

export interface CalendarCell {
  readonly day: string;
  readonly date: number;
  readonly outside: boolean;
}

export interface LocalDateTime {
  readonly day: string;
  readonly hour: number;
  readonly minute: number;
}

export function weekdayLabels(locale: Locale): readonly string[] {
  const { formatDate } = formattersFor(locale);
  return Array.from({ length: 7 }, (_, index) => formatDate(utcDate(2026, 8, 16 + index), { weekday: 'short', timeZone: 'UTC' }));
}

export const CLOCK_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export const CLOCK_MINUTES = Array.from(
  { length: Math.floor(60 / DATE_TIME_PICKER_LIMITS.minuteStep) },
  (_, index) => index * DATE_TIME_PICKER_LIMITS.minuteStep,
);

export function monthName(month: number, locale: Locale): string {
  assertMonth(month);
  const name = formattersFor(locale).formatDate(utcDate(2026, month, 1), { month: 'long', timeZone: 'UTC' });
  assert(name.length > 0, 'Every month has a name');
  return name;
}

export function dayKey(year: number, month: number, date: number): string {
  const day = `${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`;
  assert(validCalendarDay(day), 'A calendar key names a real day');
  return day;
}

export function monthOf(day: string): CalendarMonth {
  assert(validCalendarDay(day), 'A month is read from a real day');
  const month = { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
  assertMonth(month.month);
  return month;
}

export function shiftMonth(from: CalendarMonth, delta: number): CalendarMonth {
  assertMonth(from.month);
  assert(Number.isSafeInteger(delta), 'A month step is whole');
  const index = from.year * 12 + (from.month - 1) + delta;
  const first = DATE_TIME_PICKER_LIMITS.yearMin * 12;
  const last = DATE_TIME_PICKER_LIMITS.yearMax * 12 + 11;
  const bounded = Math.min(Math.max(index, first), last);
  return { year: Math.floor(bounded / 12), month: (bounded % 12) + 1 };
}

export function monthGrid(shown: CalendarMonth): readonly CalendarCell[] {
  assertMonth(shown.month);
  const firstWeekday = utcDate(shown.year, shown.month, 1).getUTCDay();
  const cells: CalendarCell[] = [];
  for (let index = 0; index < DATE_TIME_PICKER_LIMITS.gridCells; index++) {
    const date = utcDate(shown.year, shown.month, index - firstWeekday + 1);
    const month = date.getUTCMonth() + 1;
    cells.push({
      day: dayKey(date.getUTCFullYear(), month, date.getUTCDate()),
      date: date.getUTCDate(),
      outside: month !== shown.month,
    });
  }
  assert(cells.length === DATE_TIME_PICKER_LIMITS.gridCells, 'A calendar shows six weeks');
  return cells;
}

export function longDay(day: string, locale: Locale): string {
  assert(validCalendarDay(day), 'Only a real day is named');
  const { year, month } = monthOf(day);
  const date = Number(day.slice(8, 10));
  return formattersFor(locale).formatDate(utcDate(year, month, date), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function today(now: Date = new Date()): string {
  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function clockHour(hour: number): { readonly hour: number; readonly meridiem: Meridiem } {
  assertHour(hour);
  const meridiem: Meridiem = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  assert(twelve >= 1, 'A clock hour is at least 1');
  assert(twelve <= 12, 'A clock hour is at most 12');
  return { hour: twelve, meridiem };
}

export function dayHour(clock: number, meridiem: Meridiem): number {
  assert(Number.isSafeInteger(clock), 'A clock hour is whole');
  assert(clock >= 1, 'A clock hour is at least 1');
  assert(clock <= 12, 'A clock hour is at most 12');
  const hour = (clock % 12) + (meridiem === 'PM' ? 12 : 0);
  assertHour(hour);
  return hour;
}

export function localValue(value: LocalDateTime): string {
  assert(validCalendarDay(value.day), 'A date-time has a real day');
  assertHour(value.hour);
  assertMinute(value.minute);
  return `${value.day}T${pad(value.hour, 2)}:${pad(value.minute, 2)}`;
}

export function parseLocalValue(input: string): LocalDateTime | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(input);
  const day = match?.[1];
  if (match === null || day === undefined || !validCalendarDay(day)) {
    return undefined;
  }
  return { day, hour: Number(match[2]), minute: Number(match[3]) };
}

export function formatPicked(mode: PickerMode, value: string): string {
  if (mode === 'date') {
    return validCalendarDay(value) ? usDay(value) : value;
  }
  const local = parseLocalValue(value);
  if (local === undefined) {
    return value;
  }
  const clock = clockHour(local.hour);
  return `${usDay(local.day)} ${pad(clock.hour, 2)}:${pad(local.minute, 2)} ${clock.meridiem}`;
}

export function parseTyped(mode: PickerMode, typed: string): string | undefined {
  const text = typed.trim();
  if (text.length > DATE_TIME_PICKER_LIMITS.typedCharsMax) {
    return undefined;
  }
  if (text === '') {
    return '';
  }
  if (mode === 'date') {
    return typedDay(text);
  }
  const stored = parseLocalValue(text);
  if (stored !== undefined) {
    return localValue(stored);
  }
  return typedDateTime(text);
}

function typedDateTime(text: string): string | undefined {
  const match = /^(\S+)(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?$/.exec(text);
  const day = match?.[1] === undefined ? undefined : typedDay(match[1]);
  if (match === null || day === undefined) {
    return undefined;
  }
  if (match[2] === undefined) {
    return localValue({ day, hour: 0, minute: 0 });
  }
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (minute > 59) {
    return undefined;
  }
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === 'AM' || meridiem === 'PM') {
    if (hour < 1 || hour > 12) {
      return undefined;
    }
    return localValue({ day, hour: dayHour(hour, meridiem), minute });
  }
  return hour <= 23 ? localValue({ day, hour, minute }) : undefined;
}

function typedDay(text: string): string | undefined {
  if (validCalendarDay(text)) {
    return text;
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const day = `${match[3]}-${pad(Number(match[1]), 2)}-${pad(Number(match[2]), 2)}`;
  return validCalendarDay(day) ? day : undefined;
}

function usDay(day: string): string {
  assert(validCalendarDay(day), 'Only a real day is shown as one');
  return `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
}

function utcDate(year: number, month: number, date: number): Date {
  const value = new Date(Date.UTC(2000, month - 1, date));
  value.setUTCFullYear(year + (value.getUTCFullYear() - 2000));
  return value;
}

function pad(value: number, width: number): string {
  assert(Number.isSafeInteger(value), 'Only whole numbers are padded');
  assert(value >= 0, 'Only non-negative numbers are padded');
  return String(value).padStart(width, '0');
}

function assertMonth(month: number): void {
  assert(Number.isSafeInteger(month), 'A month is whole');
  assert(month >= 1, 'A month is at least 1');
  assert(month <= 12, 'A month is at most 12');
}

function assertHour(hour: number): void {
  assert(Number.isSafeInteger(hour), 'An hour is whole');
  assert(hour >= 0, 'An hour is at least 0');
  assert(hour <= 23, 'An hour is at most 23');
}

function assertMinute(minute: number): void {
  assert(Number.isSafeInteger(minute), 'A minute is whole');
  assert(minute >= 0, 'A minute is at least 0');
  assert(minute <= 59, 'A minute is at most 59');
}
