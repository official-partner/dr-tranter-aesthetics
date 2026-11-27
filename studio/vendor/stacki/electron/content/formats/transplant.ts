
function align(left: readonly string[], right: readonly string[]): Map<number, number> {
  const leftCount = left.length;
  const rightCount = right.length;
  const table = new Int32Array((leftCount + 1) * (rightCount + 1));
  const cell = (i: number, j: number): number => table[i * (rightCount + 1) + j] ?? 0;
  for (let i = leftCount - 1; i >= 0; i--) {
    for (let j = rightCount - 1; j >= 0; j--) {
      table[i * (rightCount + 1) + j] = left[i] === right[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const map = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < leftCount && j < rightCount) {
    if (left[i] === right[j]) {
      map.set(i, j);
      i++;
      j++;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return map;
}

interface Hunk {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

function hunks(left: readonly string[], right: readonly string[]): Hunk[] {
  const map = align(left, right);
  const out: Hunk[] = [];
  let open: { start: number; from: number } | undefined = undefined;
  let previousRight = -1;
  for (let i = 0; i <= left.length; i++) {
    const j = i < left.length ? map.get(i) : right.length;
    if (j === undefined) {
      if (!open) {
        open = { start: i, from: previousRight + 1 };
      }
      continue;
    }
    if (open || j > previousRight + 1) {
      const start = open ? open.start : i;
      const from = open ? open.from : previousRight + 1;
      out.push({ start, end: i, lines: right.slice(from, j) });
      open = undefined;
    }
    previousRight = j;
  }
  return out;
}

function transplant(original: string, before: string, after: string): string {
  if (before === after) {
    return original;
  }
  const originalLines = original.split('\n');
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const toOriginal = align(beforeLines, originalLines);
  const changes = hunks(beforeLines, afterLines);
  if (!changes.length) {
    return original;
  }

  const out = originalLines.slice();
  for (const hunk of changes.reverse()) {
    const mapped: (number | undefined)[] = [];
    for (let i = hunk.start; i < hunk.end; i++) {
      mapped.push(toOriginal.get(i));
    }
    const first = mapped[0];
    const last = mapped[mapped.length - 1];
    if (first !== undefined && last !== undefined && mapped.every((at) => at !== undefined)) {
      out.splice(first, last - first + 1, ...hunk.lines);
      continue;
    }

    let start = hunk.start;
    while (start > 0 && !toOriginal.has(start - 1)) {
      start--;
    }
    let end = hunk.end;
    while (end < beforeLines.length && !toOriginal.has(end)) {
      end++;
    }

    const from = start === 0 ? 0 : (toOriginal.get(start - 1) ?? 0) + 1;
    const to = end === beforeLines.length ? originalLines.length : (toOriginal.get(end) ?? originalLines.length);
    if (to < from) {
      return after;
    }

    const lines = [...beforeLines.slice(start, hunk.start), ...hunk.lines, ...beforeLines.slice(hunk.end, end)];
    out.splice(from, to - from, ...lines);
  }
  return out.join('\n');
}

export { transplant };
