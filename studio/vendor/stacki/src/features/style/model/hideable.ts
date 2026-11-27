
export type Hideable<T> = { item: T; hidden: boolean };

function splitRuns(value: string): Array<{ text: string; hidden: boolean }> {
  const text = String(value ?? '');
  const runs: Array<{ text: string; hidden: boolean }> = [];
  let i = 0;
  let start = 0;
  const pushVisible = (end: number) => {
    const piece = text.slice(start, end).trim();
    if (piece) {
      runs.push({ text: piece, hidden: false });
    }
  };
  while (i < text.length) {
    const quoted = quotedEnd(text, i);
    if (quoted !== undefined) {
      i = quoted;
      continue;
    }
    if (!text.startsWith('/*', i)) {
      i++;
      continue;
    }
    const close = text.indexOf('*/', i + 2);
    if (close === -1) {
      pushVisible(i);
      const rest = text.slice(i + 2).trim();
      if (rest) {
        runs.push({ text: rest, hidden: true });
      }
      return runs;
    }
    pushVisible(i);
    const inner = text.slice(i + 2, close).trim();
    if (inner) {
      runs.push({ text: inner, hidden: true });
    }
    i = close + 2;
    start = i;
  }
  pushVisible(text.length);
  return runs;
}

function quotedEnd(text: string, start: number): number | undefined {
  const quote = text.charAt(start);
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }
  for (let i = start + 1; i < text.length; i += 1) {
    if (text.charAt(i) === '\\') {
      i += 1;
    } else if (text.charAt(i) === quote) {
      return i + 1;
    }
  }
  return undefined;
}

export function parseHideable<T>(value: string, _sep: ',' | ' ', parseAll: (text: string) => T[]): Array<Hideable<T>> {
  const out: Array<Hideable<T>> = [];
  for (const run of splitRuns(value)) {
    if (!run.hidden && run.text.toLowerCase() === 'none') {
      continue;
    }
    const text = run.hidden ? run.text.replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '') : run.text;
    if (!text) {
      continue;
    }
    for (const item of parseAll(text) ?? []) {
      if (item === undefined || item === null) {
        continue;
      }
      out.push({ item, hidden: run.hidden });
    }
  }
  return out;
}

export function serializeHideable<T>(rows: ReadonlyArray<Hideable<T>>, sep: ',' | ' ', serializeAll: (items: T[]) => string): string {
  const parts = rows.map((row) => ({ text: serializeAll([row.item]).trim(), hidden: row.hidden })).filter((part) => part.text);
  if (!parts.length) {
    return '';
  }

  let out = '';
  let shown = false;
  for (const part of parts) {
    if (part.hidden) {
      const comma = sep === ',' && shown ? ', ' : '';
      out += `${out ? ' ' : ''}/* ${comma}${part.text} */`;
    } else {
      out += shown ? `${sep === ',' ? ',' : ''} ${part.text}` : `${out ? ' ' : ''}${part.text}`;
      shown = true;
    }
  }

  return shown ? out : `none ${out}`;
}

export const allHidden = <T>(rows: ReadonlyArray<Hideable<T>>): boolean => rows.length > 0 && rows.every((row) => row.hidden);
