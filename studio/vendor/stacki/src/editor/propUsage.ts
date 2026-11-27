
import { assert } from '../../shared/core/assert';
import { PROPERTY_LIMITS } from '../../shared/properties/propertyEditing';
import { propsPattern, readPropsDestructure, typeDeclarationSpans } from './loopProps';

export function unusedProps(source: string, names: readonly string[]): ReadonlySet<string> {
  assert(names.length <= PROPERTY_LIMITS.fieldsMax, 'unusedProps: property count is bounded');
  const { frontmatter, body } = split(source);
  const destructure = readPropsDestructure(frontmatter);
  if (destructure === undefined && /Astro\.props(?!\s*\.\s*[\w$]|\s*\[)/.test(withoutDeclarations(frontmatter) + markupExpressions(body).join('\n'))) {
    return new Set();
  }
  const locals = new Map((destructure?.entries ?? []).map((entry) => [entry.key, entry.local]));
  const reading = `${withoutDeclarations(frontmatter)}\n${markupExpressions(body).join('\n')}`;
  const pattern = propsPattern(frontmatter);
  const restLocal = pattern === undefined ? undefined : /\.\.\.\s*([A-Za-z_$][\w$]*)/.exec(frontmatter.slice(pattern.from, pattern.to))?.[1];
  const restRead = restLocal !== undefined && identifierIn(reading, restLocal);
  const unused = new Set<string>();
  for (const name of names) {
    const local = locals.get(name);
    const used =
      local === undefined
        ? restRead || !/^[A-Za-z_$][\w$]*$/.test(name) || new RegExp(`Astro\\.props\\s*(\\.\\s*${name}\\b|\\[\\s*["']${name}["']\\s*\\])`).test(source)
        : identifierIn(reading, local);
    if (!used) {
      unused.add(name);
    }
  }
  assert(unused.size <= names.length, 'unusedProps: only declared props are reported');
  return unused;
}

function split(source: string): { readonly frontmatter: string; readonly body: string } {
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---[^\n]*\n?/.exec(source) ?? undefined;
  if (match === undefined) {
    return { frontmatter: '', body: source };
  }
  return { frontmatter: match[1] ?? '', body: source.slice(match[0].length) };
}

function withoutDeclarations(frontmatter: string): string {
  const spans = [...typeDeclarationSpans(frontmatter), propsPattern(frontmatter)].filter((node) => node !== undefined);
  let out = frontmatter;
  for (const span of [...spans].sort((left, right) => right.from - left.from)) {
    out = `${out.slice(0, span.from)}${' '.repeat(span.to - span.from)}${out.slice(span.to)}`;
  }
  return out.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function markupExpressions(body: string): readonly string[] {
  const markup = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)\b([^>]*)>[\s\S]*?<\/\1>/gi, (block: string, _tag: string, attributes: string) => (/define:vars/.test(attributes) ? block : ' '));
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < markup.length; index++) {
    const character = markup.charAt(index);
    if (character === '{') {
      if (depth === 0) {
        start = index;
      }
      depth++;
    } else if (character === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        out.push(markup.slice(start, index + 1));
      }
    }
  }
  return out;
}

function identifierIn(text: string, name: string): boolean {
  assert(/^[A-Za-z_$][\w$]*$/.test(name), 'identifierIn: a local is an identifier');
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`(^|[^\\w$.]|\\.\\.\\.)${escaped}(?![\\w$])`).test(text);
}
