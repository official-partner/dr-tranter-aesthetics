
import type ts from 'typescript';
import { assert } from '../../../shared/core/assert';
import { readPropTags, tagStep } from '../../../shared/properties/propTags';
import type { DefaultRule } from '../../../shared/properties/propSchema';
import type { NumberRules } from '../astroParserTypes';

export interface StatedDefault {
  readonly value?: string | number;
  readonly hint?: string;
  readonly when?: DefaultRule;
}

const DOCUMENTATION_COMMENTS_MAX = 64;

export function commentDocumentation(text: string, position: number, ranges: readonly ts.CommentRange[]): string {
  assert(position >= 0, 'commentDocumentation: the member starts inside the text');
  assert(ranges.length <= DOCUMENTATION_COMMENTS_MAX * 4, 'commentDocumentation: comments are bounded');
  let pieces: string[] = [];
  for (let index = 0; index < ranges.length && index < DOCUMENTATION_COMMENTS_MAX; index++) {
    const range = ranges[index];
    assert(range !== undefined, 'commentDocumentation: a comment range exists');
    const before = index === 0 ? '' : text.slice(ranges[index - 1]?.end ?? range.pos, range.pos);
    if (/\n[^\S\n]*\n/.test(before)) {
      pieces = [];
    }
    pieces.push(commentText(text.slice(range.pos, range.end)));
  }
  const last = ranges.at(-1);
  if (last !== undefined && /\n[^\S\n]*\n/.test(text.slice(last.end, position))) {
    return '';
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function commentText(comment: string): string {
  if (comment.startsWith('//')) {
    return comment.slice(2).trim();
  }
  const body = comment.replace(/^\/\*/, '').replace(/\*\/$/, '');
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\*+\s?/, ''))
    .join(' ');
}

export function statedDefault(documentation: string | undefined): StatedDefault {
  if (!documentation) {
    return {};
  }
  const stated = documentation.match(/defaults?\s*(?:to|:)\s*`([^`]+)`/i) || documentation.match(/defaults?\s*(?:to|:)\s*([^`.,;]+)/i);
  if (!stated) {
    return {};
  }

  const clause = (documentation.match(/defaults?\s*(?:to|:)\s*((?:`[^`]*`|(?!;\s*use\b)[^.])+)/i) || [])[1] || '';
  const named = clause.match(/`[^`]+`/g) || [];
  const conditional = named.length > 1 || (/\bor\b/i.test(clause) && /\b(?:for|when|if|on|while|unless|with|without|depending)\b/i.test(clause));
  if (conditional) {
    const hint = clause
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*passthrough\s*/i, ' ')
      .trim();

    const rule =
      clause.match(/^\s*`([^`]+)`.*?\bor\b\s*`([^`]+)`\s*(?:when|while|if)\s+([A-Za-z_$][\w$]*)\s+(?:is|=|===)\s*`?([^`\s.,]+)`?/i) ||
      clause.match(/^\s*`([^`]+)`.*?\bor\b\s*`([^`]+)`\s*(?:when|while|if)\s+([A-Za-z_$][\w$]*)\s*$/i);
    const prop = rule?.[3];
    const then = rule?.[2];
    const otherwise = rule?.[1];
    if (prop !== undefined && then !== undefined && otherwise !== undefined) {
      return { hint, when: { prop, is: rule?.[4] === undefined ? 'true' : String(rule[4]), then, otherwise } };
    }
    return hint ? { hint } : {};
  }

  const text = (stated[1] ?? '').trim().replace(/^["']|["']$/g, '');
  if (text && text.length <= 24 && !/\s(the|a|an|whatever|sensible)\s/i.test(` ${text} `)) {
    return { value: /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text };
  }
  return {};
}

const NUMBER_RE = String.raw`-?\d+(?:\.\d+)?`;
const UNSIGNED_RE = String.raw`\d+(?:\.\d+)?`;
export function numberRules(documentation: string | undefined): NumberRules {
  if (!documentation) {
    return {};
  }
  const tags = readPropTags(documentation);
  const rules: NumberRules = {};
  if (tags.min !== undefined) {
    rules.min = tags.min;
  }
  if (tags.max !== undefined) {
    rules.max = tags.max;
  }
  const step = tagStep(tags);
  if (step !== undefined) {
    rules.step = step;
  }
  let prose = documentation.replace(/@\w+\s+-?[\d.]+/g, ' ');
  const take = (re: RegExp, apply: (a: number, b: number) => void) => {
    const match = prose.match(re);
    if (!match) {
      return;
    }
    apply(Number.parseFloat(match[1] ?? ''), Number.parseFloat(match[2] ?? ''));
    prose = prose.replace(match[0], ' ');
  };
  take(new RegExp(`between\\s+(${NUMBER_RE})\\s+and\\s+(${NUMBER_RE})`, 'i'), (low, high) => {
    if (rules.min === undefined) {
      rules.min = low;
    }
    if (rules.max === undefined) {
      rules.max = high;
    }
  });
  const fromRange = (low: number, high: number) => {
    if (low <= high) {
      if (rules.min === undefined) {
        rules.min = low;
      }
      if (rules.max === undefined) {
        rules.max = high;
      }
    }
  };
  take(new RegExp(`\\bfrom\\s+(${NUMBER_RE})\\s+(?:to|through)\\s+(${NUMBER_RE})`, 'i'), fromRange);
  take(new RegExp(`(?<![\\w\\-–—]|\\d\\.)(${UNSIGNED_RE})\\s*[–—]\\s*(${UNSIGNED_RE})(?![\\w\\-–—]|\\.\\d)`), fromRange);
  take(new RegExp(`(?<![\\w\\-–—]|\\d\\.)(${UNSIGNED_RE})-(${UNSIGNED_RE})(?![\\w\\-–—]|\\.\\d)`), fromRange);
  take(new RegExp(`(?:no more than|not more than|at most|maximum(?: of)?|up to)\\s+(${NUMBER_RE})`, 'i'), (bound) => {
    if (rules.max === undefined) {
      rules.max = bound;
    }
  });
  take(new RegExp(`(?:no less than|not less than|at least|minimum(?: of)?)\\s+(${NUMBER_RE})`, 'i'), (bound) => {
    if (rules.min === undefined) {
      rules.min = bound;
    }
  });
  take(new RegExp(`(?:greater than|more than|above)\\s+(${NUMBER_RE})`, 'i'), (bound) => {
    if (rules.min !== undefined) {
      return;
    }
    rules.min = bound;
    rules.minExclusive = true;
  });
  take(new RegExp(`(?:less than|below|under)\\s+(${NUMBER_RE})`, 'i'), (bound) => {
    if (rules.max !== undefined) {
      return;
    }
    rules.max = bound;
    rules.maxExclusive = true;
  });
  if (rules.step === undefined && /\b(whole numbers?|integers?|no decimals?)\b/i.test(prose)) {
    rules.step = 1;
  }
  if (rules.min !== undefined && rules.max !== undefined && rules.max < rules.min) {
    delete rules.max;
    delete rules.maxExclusive;
  }
  return rules;
}

export function sharedDocumentation(branchDocs: readonly Readonly<Record<string, string>>[]): ReadonlyMap<string, string> {
  const perName = new Map<string, Set<string>>();
  for (const docs of branchDocs) {
    for (const [name, documentation] of Object.entries(docs)) {
      const set = perName.get(name) ?? new Set<string>();
      set.add(documentation);
      perName.set(name, set);
    }
  }
  const shared = new Map<string, string>();
  for (const [name, docs] of perName) {
    if (docs.size < 2) {
      continue;
    }
    const all = [...docs];
    const first = all[0] ?? '';
    let index = 0;
    while (index < first.length && all.every((other) => other[index] === first[index])) {
      index++;
    }
    const cut = first.slice(0, index).lastIndexOf('.');
    const common = cut === -1 ? '' : first.slice(0, cut + 1).trim();
    if (common) {
      shared.set(name, common);
    }
  }
  assert(shared.size <= perName.size, 'sharedDocumentation: one entry per documented name at most');
  return shared;
}
