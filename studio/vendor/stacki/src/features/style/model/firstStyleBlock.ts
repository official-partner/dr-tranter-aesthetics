
import { assert } from '../../../../shared/core/assert';
import { indentUnitOf } from '../../../../shared/core/indent';
import { described, type Described } from '../../../../shared/properties/i18n/messageRef';

export const AUTO_CLASS_BASE = 'class';

const AUTO_CLASS_SELECTOR = /^\.class(?:-(?:[2-9]|[1-9]\d+))?$/;

const STYLE_BLOCK_FILE = /\.astro$/i;

export function styleBlockFileSupported(filePath: string | undefined): boolean {
  return filePath !== undefined && STYLE_BLOCK_FILE.test(filePath);
}

export function isAutoClassSelector(selector: string): boolean {
  return AUTO_CLASS_SELECTOR.test(selector.trim());
}

export function autoClassName(taken: ReadonlySet<string>): string {
  const candidatesMax = taken.size + 1;
  let free: string | undefined = undefined;
  for (let ordinal = 1; ordinal <= candidatesMax && free === undefined; ordinal += 1) {
    const candidate = ordinal === 1 ? AUTO_CLASS_BASE : `${AUTO_CLASS_BASE}-${ordinal}`;
    free = taken.has(candidate) ? undefined : candidate;
  }
  assert(free !== undefined, 'autoClassName: a free name exists among taken.size + 1 candidates');
  return free;
}

export type FirstStylesInput = {
  readonly selector: string;
  readonly tag: string | undefined;
  readonly elementClasses: readonly string[];
  readonly sourceCount: number;
  readonly ruleSelectors: readonly string[];
  readonly takenClasses: ReadonlySet<string>;
  readonly filePath: string | undefined;
  readonly createStyleTag?: 'chosen' | 'not-chosen';
};

export type FirstStylesPlan =
  | { readonly kind: 'normal' }
  | { readonly kind: 'block' }
  | { readonly kind: 'block-and-class'; readonly className: string }
  | { readonly kind: 'class'; readonly className: string }
  | ({ readonly kind: 'refused' } & Described);

export const UNSUPPORTED_FILE = described('styleModel.write.unsupportedFile');
export const UNSUPPORTED_FILE_MESSAGE = UNSUPPORTED_FILE.message;

export function planFirstStyles(input: FirstStylesInput): FirstStylesPlan {
  const { selector, tag, elementClasses, sourceCount, ruleSelectors, takenClasses, filePath } = input;
  const createChosen = input.createStyleTag === 'chosen';
  assert(sourceCount >= 0, 'planFirstStyles: a count of sources is not negative');
  assert(Number.isSafeInteger(sourceCount), 'planFirstStyles: a count of sources is an integer');
  const bareTag = tag !== undefined && selector === tag && elementClasses.length === 0;
  if (sourceCount === 0 || createChosen) {
    if (!styleBlockFileSupported(filePath)) {
      return { kind: 'refused', ...UNSUPPORTED_FILE };
    }
    return bareTag && sourceCount === 0 ? { kind: 'block-and-class', className: autoClassName(takenClasses) } : { kind: 'block' };
  }
  const ownRulesOnly = ruleSelectors.length > 0 && ruleSelectors.every(isAutoClassSelector);
  if (ownRulesOnly && bareTag) {
    return { kind: 'class', className: autoClassName(takenClasses) };
  }
  return { kind: 'normal' };
}

export type FileLayout = { readonly unit: string; readonly eol: '\n' | '\r\n' };

export function fileLayoutOf(source: string): FileLayout {
  return { unit: indentUnitOf(source), eol: source.includes('\r\n') ? '\r\n' : '\n' };
}

export function styleBlockInner(css: string, layout: FileLayout): string {
  const lines = css.replace(/^\n+|\s+$/g, '').split('\n');
  assert(lines[0] !== undefined, 'styleBlockInner: a split always has a first line');
  assert(lines[0].length > 0, 'styleBlockInner: a block holds at least one rule line');
  assert(!css.includes('\r'), 'styleBlockInner: the panel builds CSS with \\n line ends');
  const indented = lines.map((line) => {
    if (line.length === 0) {
      return line;
    }
    const tabs = /^\t*/.exec(line)?.[0].length ?? 0;
    return `${layout.unit}${layout.unit.repeat(tabs)}${line.slice(tabs)}`;
  });
  return `${layout.eol}${indented.join(layout.eol)}${layout.eol}`;
}
