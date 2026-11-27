import type { MessageKey } from '../../../../shared/properties/i18n/messageRef';

export type Origin = { x: string; y: string; z: string };

const X_WORD: Record<string, string> = { left: '0%', center: '50%', right: '100%' };
const Y_WORD: Record<string, string> = { top: '0%', center: '50%', bottom: '100%' };

export const CENTER: Origin = { x: '50%', y: '50%', z: '' };

function splitSpaces(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? '';
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current.trim()) {
        out.push(current.trim());
      }
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    out.push(current.trim());
  }
  return out;
}

export function parseOrigin(value: string): Origin {
  const parts = splitSpaces(String(value ?? '').trim());
  if (!parts.length) {
    return { ...CENTER };
  }
  const lower = parts.map((part) => part.toLowerCase());

  if (parts.length === 1) {
    const first = lower[0] ?? '';
    if (first in Y_WORD && !(first in X_WORD)) {
      return { x: '50%', y: Y_WORD[first] ?? '50%', z: '' };
    }
    if (first in X_WORD) {
      return { x: X_WORD[first] ?? '50%', y: '50%', z: '' };
    }
    return { x: parts[0] ?? '50%', y: '50%', z: '' };
  }

  const firstLower = lower[0] ?? '';
  const secondLower = lower[1] ?? '';
  const swapped = (firstLower in Y_WORD && !(firstLower in X_WORD)) || (secondLower in X_WORD && !(secondLower in Y_WORD));
  const rawX = (swapped ? parts[1] : parts[0]) ?? '50%';
  const rawY = (swapped ? parts[0] : parts[1]) ?? '50%';
  return {
    x: X_WORD[rawX.toLowerCase()] ?? rawX,
    y: Y_WORD[rawY.toLowerCase()] ?? rawY,
    z: parts[2] ?? '',
  };
}

export function serializeOrigin(origin: Origin): string {
  const x = (origin.x || '').trim() || '50%';
  const y = (origin.y || '').trim() || '50%';
  const z = (origin.z || '').trim();
  if (!z && x === '50%' && y === '50%') {
    return '';
  }
  return z ? `${x} ${y} ${z}` : `${x} ${y}`;
}

export const ORIGIN_PRESETS: ReadonlyArray<{ x: string; y: string; label: string; labelKey: MessageKey }> = [
  { x: '0%', y: '0%', label: 'Top left', labelKey: 'styleModel.transform.origin.topLeft' },
  { x: '50%', y: '0%', label: 'Top', labelKey: 'styleModel.transform.origin.top' },
  { x: '100%', y: '0%', label: 'Top right', labelKey: 'styleModel.transform.origin.topRight' },
  { x: '0%', y: '50%', label: 'Left', labelKey: 'styleModel.transform.origin.left' },
  { x: '50%', y: '50%', label: 'Center', labelKey: 'styleModel.transform.origin.center' },
  { x: '100%', y: '50%', label: 'Right', labelKey: 'styleModel.transform.origin.right' },
  { x: '0%', y: '100%', label: 'Bottom left', labelKey: 'styleModel.transform.origin.bottomLeft' },
  { x: '50%', y: '100%', label: 'Bottom', labelKey: 'styleModel.transform.origin.bottom' },
  { x: '100%', y: '100%', label: 'Bottom right', labelKey: 'styleModel.transform.origin.bottomRight' },
];

const samePosition = (left: string, right: string): boolean => {
  const normalize = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/^0(?:px|%|em|rem)$/, '0');
  return normalize(left) === normalize(right);
};

export const originPreset = (origin: Origin): number =>
  ORIGIN_PRESETS.findIndex((preset) => samePosition(preset.x, origin.x) && samePosition(preset.y, origin.y));

export function takeSelfPerspective(value: string): { distance: string; rest: string } {
  const text = String(value ?? '');
  let i = 0;
  let depth = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    const ch = text[i] ?? '';
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && /[a-z]/i.test(ch)) {
      const at = /^perspective\s*\(/i.exec(text.slice(i));
      if (at && (i === 0 || !/[\w-]/.test(text[i - 1] ?? ''))) {
        let j = i + at[0].length;
        let nesting = 1;
        while (j < text.length && nesting > 0) {
          if ((text[j] ?? '') === '(') {
            nesting++;
          } else if ((text[j] ?? '') === ')') {
            nesting--;
          }
          j++;
        }
        const distance = text.slice(i + at[0].length, j - 1).trim();
        const rest = `${text.slice(0, i)} ${text.slice(j)}`.replace(/\s+/g, ' ').trim();
        return { distance, rest };
      }
      while (i < text.length && /[\w-]/.test(text[i] ?? '')) {
        i++;
      }
      continue;
    }
    i++;
  }
  return { distance: '', rest: text.trim() };
}

export function withSelfPerspective(rest: string, distance: string): string {
  const trimmed = (distance || '').trim();
  const body = (rest || '').trim();
  if (!trimmed || /^0(?:[a-z]*|%)$/i.test(trimmed)) {
    return body;
  }
  const layers = body.replace(/^none\b\s*/i, '');
  return layers ? `perspective(${trimmed}) ${layers}` : `perspective(${trimmed})`;
}
