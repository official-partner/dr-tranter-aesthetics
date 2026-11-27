import { useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { CMS_REMOTE_LIMITS, type RemoteCell, type RemoteDocumentSummary } from '../../../shared/properties/cmsRemote';
import type { RemoteSchemaField } from '../../../shared/properties/cmsRemoteSchema';
import { ENGLISH_REMOTE_TEXT, type RemoteText } from './remoteTime';

export interface RemoteColumn {
  readonly name: string;
  readonly title: string;
}

export type RemoteSortKey = 'title' | 'status' | 'updated' | `cell:${string}`;

export interface RemoteSort {
  readonly key: RemoteSortKey;
  readonly direction: 'ascending' | 'descending';
}

export function nextSort(current: RemoteSort | undefined, key: RemoteSortKey): RemoteSort {
  if (current?.key === key) {
    return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  }
  return { key, direction: 'ascending' };
}

export function sortItems(items: readonly RemoteDocumentSummary[], sort: RemoteSort | undefined): readonly RemoteDocumentSummary[] {
  if (sort === undefined) {
    return items;
  }
  const sign = sort.direction === 'ascending' ? 1 : -1;
  const sorted = [...items].sort((left, right) => {
    const first = sortValue(left, sort.key);
    const second = sortValue(right, sort.key);
    if (first === undefined || second === undefined) {
      return first === second ? 0 : first === undefined ? 1 : -1;
    }
    return sign * compare(first, second);
  });
  assert(sorted.length === items.length, 'Sorting keeps every row');
  return sorted;
}

function sortValue(item: RemoteDocumentSummary, key: RemoteSortKey): RemoteCell | undefined {
  switch (key) {
    case 'title':
      return item.title;
    case 'status':
      return item.status;
    case 'updated': {
      const time = Date.parse(item.updatedAt);
      return Number.isNaN(time) ? undefined : time;
    }
    default:
      return item.cells?.[key.slice('cell:'.length)];
  }
}

function compare(left: RemoteCell, right: RemoteCell): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function cellText(cell: RemoteCell | undefined, text: RemoteText = ENGLISH_REMOTE_TEXT): string {
  if (cell === undefined || cell === '') {
    return '—';
  }
  if (typeof cell === 'boolean') {
    return text.translate(cell ? 'cmsRemote.common.yes' : 'cmsRemote.common.no');
  }
  if (typeof cell === 'string') {
    return dateText(cell, text) ?? cell;
  }
  return String(cell);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

function dateText(value: string, text: RemoteText): string | undefined {
  const day = { month: 'short', day: 'numeric', year: 'numeric' } as const;
  if (ISO_DATE.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : text.format.formatDate(date, day);
  }
  if (ISO_DATETIME.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    const midnight = date.getHours() === 0 && date.getMinutes() === 0;
    return text.format.formatDate(date, midnight ? day : { ...day, hour: 'numeric', minute: '2-digit' });
  }
  return undefined;
}

export function columnFields(fields: readonly RemoteSchemaField[]): readonly RemoteColumn[] {
  return fields
    .filter((field) => {
      const { type } = field;
      if (type.kind === 'string') {
        return type.asset === undefined;
      }
      if (type.kind === 'array') {
        return type.of.every((member) => member.kind === 'string' || member.kind === 'reference');
      }
      return !['object', 'image', 'file', 'geopoint', 'richText'].includes(type.kind);
    })
    .map((field) => ({ name: field.name, title: field.title || field.name }));
}

const NAME_MIN_PX = 220;
const STATUS_PX = 110;
const COLUMN_MIN_PX = 150;
const UPDATED_PX = 130;
const PIN_PX = 36;
const LEAD_PX = 28;

export function tableGrid(shape: { readonly lead: boolean; readonly status: boolean; readonly columns: number }): {
  readonly columns: string;
  readonly widthPx: number;
} {
  assert(shape.columns <= CMS_REMOTE_LIMITS.columnsMax, 'A table shows few columns');
  const parts = [
    ...(shape.lead ? [`${LEAD_PX}px`] : []),
    `minmax(${NAME_MIN_PX}px, 2fr)`,
    ...(shape.status ? [`${STATUS_PX}px`] : []),
    ...Array.from({ length: shape.columns }, () => `minmax(${COLUMN_MIN_PX}px, 1fr)`),
    `${UPDATED_PX}px`,
    `${PIN_PX}px`,
  ];
  const widthPx = (shape.lead ? LEAD_PX : 0) + NAME_MIN_PX + (shape.status ? STATUS_PX : 0) + shape.columns * COLUMN_MIN_PX + UPDATED_PX + PIN_PX;
  assert(widthPx > NAME_MIN_PX, 'A table is wider than its name column');
  return { columns: parts.join(' '), widthPx };
}

export function useColumnChoice(key: string): readonly [readonly RemoteColumn[], (columns: readonly RemoteColumn[]) => void] {
  const storageKey = `stacki:cms-columns:${key}`;
  const [columns, setColumns] = useState<readonly RemoteColumn[]>(() => readColumns(storageKey));
  const choose = (next: readonly RemoteColumn[]) => {
    const bounded = next.slice(0, CMS_REMOTE_LIMITS.columnsMax);
    setColumns(bounded);
    try {
      localStorage.setItem(storageKey, JSON.stringify(bounded));
    } catch {
    }
  };
  return [columns, choose];
}

function readColumns(storageKey: string): readonly RemoteColumn[] {
  let stored: unknown;
  try {
    const raw = localStorage.getItem(storageKey);
    stored = raw === null ? [] : parseStored(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) {
    return [];
  }
  const items: readonly unknown[] = stored;
  return items.slice(0, CMS_REMOTE_LIMITS.columnsMax).flatMap((item): RemoteColumn[] => {
    const name: unknown = typeof item === 'object' && item !== null ? Reflect.get(item, 'name') : 0;
    const title: unknown = typeof item === 'object' && item !== null ? Reflect.get(item, 'title') : 0;
    const valid = typeof name === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(name) && !name.startsWith('_');
    return valid && typeof title === 'string' ? [{ name, title: title.slice(0, 200) }] : [];
  });
}

function parseStored(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  return value;
}
