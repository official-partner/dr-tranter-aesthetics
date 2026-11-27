import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';


const FLUID_LIMITS = { referenceDepthMax: 8 } as const;

export function resolveValue(value: string, values?: Readonly<Record<string, string>>, overrides?: Readonly<Record<string, string>>, depth = 0): string {
  if (depth > FLUID_LIMITS.referenceDepthMax) {
    return value;
  }
  const next = String(value).replace(
    /var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (whole: string, name: string, fallback: string | undefined): string => {
      const found = overrides?.[name] ?? values?.[name];
      if (found !== undefined) {
        return found;
      }
      return fallback !== undefined ? fallback.trim() : whole;
    },
  );
  return next === String(value) ? next : resolveValue(next, values, overrides, depth + 1);
}


export function splitArgs(text: string): readonly string[] {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

export function evaluate(text: unknown, viewportWidth: number): number | undefined {
  const source = String(text);
  if (source.length > LIMITS.nodeValueCharsMax) {
    return undefined;
  }
  return new ArithmeticReader(source, viewportWidth).read();
}

class ArithmeticReader {
  private position = 0;
  constructor(
    private readonly source: string,
    private readonly viewportWidth: number,
  ) {}

  read(): number | undefined {
    const value = this.expression(0);
    this.skip();
    return this.position === this.source.length ? value : undefined;
  }

  private skip(): void {
    while (this.position < this.source.length && /\s/.test(this.source.charAt(this.position))) {
      this.position++;
    }
  }

  private expression(depth: number): number | undefined {
    let value = this.term(depth);
    for (let count = 0; count <= this.source.length; count++) {
      this.skip();
      const operator = this.source[this.position];
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.position++;
      const right = this.term(depth);
      if (right === undefined || value === undefined) {
        return undefined;
      }
      value = operator === '+' ? value + right : value - right;
    }
    assert(false, 'Arithmetic expression must consume input');
  }

  private term(depth: number): number | undefined {
    let value = this.factor(depth);
    for (let count = 0; count <= this.source.length; count++) {
      this.skip();
      const operator = this.source[this.position];
      if (operator !== '*' && operator !== '/') {
        return value;
      }
      this.position++;
      const right = this.factor(depth);
      if (right === undefined || value === undefined) {
        return undefined;
      }
      value = operator === '*' ? value * right : value / right;
    }
    assert(false, 'Arithmetic term must consume input');
  }

  private factor(depth: number): number | undefined {
    if (depth > LIMITS.treeDepthMax) {
      return undefined;
    }
    this.skip();
    if (this.source[this.position] === '(') {
      this.position++;
      const value = this.expression(depth + 1);
      this.skip();
      if (this.source[this.position] !== ')') {
        return undefined;
      }
      this.position++;
      return value;
    }
    if (this.source[this.position] === '-') {
      this.position++;
      const value = this.factor(depth + 1);
      return value === undefined ? undefined : -value;
    }
    const match = /^([0-9]*\.?[0-9]+)(px|rem|em|vw|vh|%)?/.exec(this.source.slice(this.position));
    if (!match?.[1]) {
      return undefined;
    }
    this.position += match[0].length;
    const number = parseFloat(match[1]);
    switch (match[2]) {
      case undefined:
      case 'rem':
        return number;
      case 'px':
        return number / 16;
      case 'vw':
        return number * this.viewportWidth;
      default:
        return undefined;
    }
  }
}

export const FLUID_LINK = 'https://www.smashingmagazine.com/2023/11/' + 'addressing-accessibility-concerns-fluid-type/#conclusion';

export function fluidCheck(resolved: unknown) {
  const text = String(resolved || '').trim();
  const match = /^clamp\(([\s\S]*)\)$/i.exec(text);
  if (!match) {
    return undefined;
  }
  const args = splitArgs(match[1] ?? '');
  if (args.length !== 3) {
    return undefined;
  }

  const min = evaluate(args[0], 0);
  const max = evaluate(args[2], 0);
  const base = evaluate(args[1], 0);
  const atOne = evaluate(args[1], 1);
  if ([min, max, base, atOne].some((reading) => reading === undefined || !Number.isFinite(reading))) {
    return undefined;
  }
  if (min === undefined || max === undefined || base === undefined || atOne === undefined) {
    return undefined;
  }
  const vw = atOne - base;
  if (vw === 0) {
    return undefined;
  }

  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const accessible = high <= 2.5 * low;
  const zooms = base > 0;
  return {
    status: !accessible ? 'error' : !zooms ? 'warning' : 'ok',
    min: low,
    max: high,
    rem: base,
    vw,
    link: FLUID_LINK,
  };
}
