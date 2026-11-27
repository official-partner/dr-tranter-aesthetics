
import { assert } from '../../../shared/core/assert';
import { remoteList, remoteObject, type RemoteValue } from '../../../shared/properties/cmsRemoteSchema';

type Fields = { readonly [key: string]: RemoteValue };

const DECORATOR_TAGS: Readonly<Record<string, string>> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'underline',
  s: 'strike-through',
  strike: 'strike-through',
  code: 'code',
};
const DECORATOR_HTML: Readonly<Record<string, string>> = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  'strike-through': 's',
  code: 'code',
};
const BLOCK_STYLES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'];
const BLOCKS_MAX = 2000;
const NODES_MAX = 50_000;

export function portableTextHTML(value: RemoteValue | undefined): string {
  const blocks = (remoteList(value) ?? []).flatMap((item) => {
    const block = remoteObject(item);
    return block?.['_type'] === 'block' ? [block] : [];
  });
  assert(blocks.length <= BLOCKS_MAX, 'Rich text stays within its block bound');
  let html = '';
  let list: string | undefined;
  for (const block of blocks) {
    const item = block['listItem'];
    const tag = item === 'number' ? 'ol' : item === 'bullet' ? 'ul' : undefined;
    if (list !== tag) {
      html += list ? `</${list}>` : '';
      html += tag ? `<${tag}>` : '';
      list = tag;
    }
    const inner = spansHTML(block);
    if (tag) {
      html += `<li>${inner}</li>`;
    } else {
      const style = typeof block['style'] === 'string' ? block['style'] : 'normal';
      const element = BLOCK_STYLES.includes(style) ? style : 'p';
      html += `<${element}>${inner}</${element}>`;
    }
  }
  return html + (list ? `</${list}>` : '');
}

export function htmlPortableText(
  html: string,
  previous: RemoteValue | undefined,
  context: { readonly document: Document; readonly key: () => string },
): RemoteValue[] {
  const template = context.document.createElement('template');
  template.innerHTML = html;
  const blocks: RemoteValue[] = [];
  let nodes = 0;
  const tick = () => {
    nodes += 1;
    assert(nodes <= NODES_MAX, 'Rich text stays within its node bound');
  };
  let loose: Node[] = [];
  const flush = () => {
    if (loose.some((node) => (node.textContent ?? '').trim() !== '')) {
      blocks.push(blockOf(loose, { style: 'normal' }, { ...context, tick }));
    }
    loose = [];
  };
  for (const node of Array.from(template.content.childNodes)) {
    const tag = isElement(node) ? node.localName : undefined;
    if (tag === 'ul' || tag === 'ol') {
      flush();
      for (const item of Array.from(node.childNodes)) {
        const listItem = tag === 'ol' ? 'number' : 'bullet';
        blocks.push(blockOf(Array.from(item.childNodes), { style: 'normal', listItem }, { ...context, tick }));
      }
    } else if (tag !== undefined && ['p', 'div', ...BLOCK_STYLES].includes(tag)) {
      flush();
      const style = BLOCK_STYLES.includes(tag) ? tag : 'normal';
      blocks.push(blockOf(Array.from(node.childNodes), { style }, { ...context, tick }));
    } else {
      loose.push(node);
    }
  }
  flush();
  const kept = (remoteList(previous) ?? []).filter((item) => remoteObject(item)?.['_type'] !== 'block');
  assert(blocks.length <= BLOCKS_MAX, 'An edit stays within the block bound');
  return [...blocks, ...kept];
}

function spansHTML(block: Fields): string {
  const definitions = new Map<string, string>();
  for (const entry of remoteList(block[MARK_DEFINITIONS]) ?? []) {
    const definition = remoteObject(entry);
    const key = definition?.['_key'];
    const href = definition?.['href'];
    if (typeof key === 'string' && typeof href === 'string') {
      definitions.set(key, href);
    }
  }
  return (remoteList(block['children']) ?? [])
    .map((child) => {
      const span = remoteObject(child);
      const text = typeof span?.['text'] === 'string' ? span['text'] : '';
      let html = escapeHTML(text).replace(/\n/g, '<br>');
      for (const mark of remoteList(span?.['marks']) ?? []) {
        const tag = typeof mark === 'string' ? DECORATOR_HTML[mark] : undefined;
        const href = typeof mark === 'string' ? definitions.get(mark) : undefined;
        if (tag !== undefined) {
          html = `<${tag}>${html}</${tag}>`;
        } else if (href !== undefined) {
          html = `<a href="${escapeHTML(href)}">${html}</a>`;
        }
      }
      return html;
    })
    .join('');
}

interface Reading {
  readonly document: Document;
  readonly key: () => string;
  readonly tick: () => void;
}

const MARK_DEFINITIONS = 'markDefs';

function blockOf(nodes: readonly Node[], shape: { readonly style: string; readonly listItem?: string }, reading: Reading): RemoteValue {
  const children: Fields[] = [];
  const definitions: Fields[] = [];
  const queue: { readonly node: Node; readonly marks: readonly string[] }[] = nodes.map((node) => ({
    node,
    marks: [],
  }));
  while (queue.length > 0) {
    const next = queue.shift();
    reading.tick();
    if (next === undefined) {
      break;
    }
    const { node, marks } = next;
    if (node.nodeType === node.TEXT_NODE) {
      children.push(span(node.textContent ?? '', marks, reading));
    } else if (isElement(node)) {
      const own = markOf(node, definitions, reading);
      const inner = own === undefined ? marks : [...marks, own];
      if (node.localName === 'br') {
        children.push(span('\n', marks, reading));
      }
      queue.unshift(...Array.from(node.childNodes).map((child) => ({ node: child, marks: inner })));
    }
  }
  return {
    _type: 'block',
    _key: reading.key(),
    style: shape.style,
    ...(shape.listItem === undefined ? {} : { listItem: shape.listItem, level: 1 }),
    [MARK_DEFINITIONS]: definitions,
    children: children.length > 0 ? children : [span('', [], reading)],
  };
}

function markOf(element: Element, definitions: Fields[], reading: Reading): string | undefined {
  const decorator = DECORATOR_TAGS[element.localName];
  if (decorator !== undefined) {
    return decorator;
  }
  const href = element.localName === 'a' ? element.getAttribute('href') : undefined;
  if (href === undefined || href === null) {
    return undefined;
  }
  const key = reading.key();
  definitions.push({ _type: 'link', _key: key, href });
  return key;
}

function span(text: string, marks: readonly string[], reading: Reading): Fields {
  return { _type: 'span', _key: reading.key(), text, marks: [...new Set(marks)] };
}

function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isElement(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}
