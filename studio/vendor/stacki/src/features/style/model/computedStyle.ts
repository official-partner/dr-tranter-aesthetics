import { useStableStyleValue } from './useStableStyleValue';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CASCADE_PROPERTIES_MAX, parseCascadeProperty, type CascadeProperty } from '../../../../shared/properties/cascadeOrigin';
import { hasCanvas, onCanvasReady, queryCanvas } from '../../../editor/canvasQuery';
import { assert } from '../../../../shared/core/assert';
import { findNode, getHost, onHostChange } from './host';
import { createQueryCache } from './queryCache';
import { textStyleContext } from './styleQuery';

const AUTHORED_PREFIX = 'authored:';
const SOURCE_LABEL_PREFIX = 'source-label:';
const SOURCE_PATH_PREFIX = 'source-path:';
const CASCADE_PREFIX = 'cascade:';
const DECLARED_PREFIX = 'declared:';
const PREFIXES = [AUTHORED_PREFIX, SOURCE_LABEL_PREFIX, SOURCE_PATH_PREFIX, CASCADE_PREFIX, DECLARED_PREFIX];
const ELEMENT_KEY_SEPARATOR = '\u0000';
const cache = createQueryCache(async (elementKey, keys) => {
  const { nodeId, path } = parseElementKey(elementKey);
  const expected = tagOf(nodeId);
  const propertyOf = (key: string) => {
    const prefix = PREFIXES.find((prefix) => key.startsWith(prefix));
    return prefix ? key.slice(prefix.length) : key;
  };
  const props = [...new Set(keys.map(propertyOf))];
  const answer = await queryCanvas(path, [], [], props, textStyleContext(path, nodeId));
  const tag = answer?.identity?.tag;
  if (tag && expected && tag !== expected) {
    return undefined;
  }
  return Object.fromEntries(
    keys.map((key) => {
      const property = propertyOf(key);
      const source = answer?.inheritedSources?.[property];
      if (key.startsWith(CASCADE_PREFIX)) {
        const origin = answer?.authoredOrigins[property];
        return [key, origin === undefined ? undefined : JSON.stringify(origin)];
      }
      if (key.startsWith(SOURCE_LABEL_PREFIX)) {
        return [key, source?.label];
      }
      if (key.startsWith(SOURCE_PATH_PREFIX)) {
        return [key, source?.path];
      }
      if (key.startsWith(DECLARED_PREFIX)) {
        return [key, answer?.authoredProps[property]?.trim()];
      }
      const computed = answer?.computedProps[property];
      const value = key.startsWith(AUTHORED_PREFIX) ? answer?.authoredProps[property] || computed : computed;
      return [key, value?.trim()];
    }),
  );
});

function currentCache() {
  const host = getHost();
  cache.setScope([host.projectPath, host.openFilePath, host.nodes, host.device, host.historyTick]);
  return cache;
}

function elementKeyOf(nodeId: string, path: string): string {
  assert(nodeId.length > 0, 'elementKeyOf: a node id is never empty');
  assert(!nodeId.includes(ELEMENT_KEY_SEPARATOR), 'elementKeyOf: a node id holds no separator');
  return `${nodeId}${ELEMENT_KEY_SEPARATOR}${path}`;
}

function parseElementKey(elementKey: string): { readonly nodeId: string; readonly path: string } {
  const separator = elementKey.indexOf(ELEMENT_KEY_SEPARATOR);
  assert(separator > 0, 'parseElementKey: the key names a node');
  return { nodeId: elementKey.slice(0, separator), path: elementKey.slice(separator + 1) };
}

const LEARNED_KEYS_MAX = 512;
const learnedKeys = new Set<string>();

function learnKey(key: string): void {
  if (learnedKeys.size < LEARNED_KEYS_MAX) {
    learnedKeys.add(key);
  }
  assert(learnedKeys.size <= LEARNED_KEYS_MAX, 'learnKey: the learned keys are bounded');
}

export function computedStylesSettled(nodeId: string): boolean {
  const path = hasCanvas() ? renderedPathOf(nodeId) : undefined;
  if (path === undefined || path.length === 0) {
    return true;
  }
  const elementKey = elementKeyOf(nodeId, path);
  const reading = currentCache();
  return [...learnedKeys].every((key) => reading.read(elementKey, key).kind === 'settled');
}

export async function prefetchComputedStyles(nodeId: string): Promise<void> {
  const path = hasCanvas() ? renderedPathOf(nodeId) : undefined;
  if (path === undefined || path.length === 0) {
    return;
  }
  const elementKey = elementKeyOf(nodeId, path);
  const asking = currentCache();
  await Promise.all([...learnedKeys].map((key) => asking.request(elementKey, key)));
}

export function forgetComputedStyles(): void {
  cache.clear();
}
onCanvasReady(forgetComputedStyles);

function selectionKey(): string | undefined {
  const nodeId = getHost().selectedId;
  if (nodeId === undefined || nodeId.length === 0) {
    return undefined;
  }
  const path = renderedPathOf(nodeId);
  return path ? elementKeyOf(nodeId, path) : undefined;
}

const RENDERED_PATHS_MAX = 512;
const renderedPaths = new Map<string, string>();

function renderedPathOf(nodeId: string): string | undefined {
  const path = getHost().pathOf?.(nodeId);
  if (path === undefined || path.length === 0) {
    return renderedPaths.get(nodeId);
  }
  if (renderedPaths.size >= RENDERED_PATHS_MAX) {
    renderedPaths.clear();
  }
  renderedPaths.set(nodeId, path);
  assert(renderedPaths.size <= RENDERED_PATHS_MAX, 'renderedPathOf: the remembered paths are bounded');
  return path;
}

function tagOf(nodeId: string): string | undefined {
  const node = findNode(getHost().nodes, nodeId);
  if (node?.kind !== 'element') {
    return undefined;
  }
  const name = node.name ?? '';
  return /^[a-z][a-z0-9-]*$/.test(name) ? name : undefined;
}

type Answer = { value: string; pending: boolean; path: string | undefined };

function answeredNow(prop: string): Answer {
  if (!prop) {
    return { value: '', pending: false, path: undefined };
  }
  const path = hasCanvas() ? selectionKey() : undefined;
  if (!path) {
    return { value: '', pending: false, path: undefined };
  }
  learnKey(prop);
  const known = currentCache().read(path, prop);
  if (known.kind === 'pending') {
    return { value: lastAnswers.get(lastAnswerKey(path, prop)) ?? '', pending: true, path };
  }
  rememberAnswer(path, prop, known.answer ?? '');
  return { value: known.answer ?? '', pending: false, path };
}

const LAST_ANSWERS_MAX = 2048;
const lastAnswers = new Map<string, string>();

function lastAnswerKey(path: string, prop: string): string {
  const host = getHost();
  return [host.projectPath ?? '', host.openFilePath ?? '', path, prop].join(ELEMENT_KEY_SEPARATOR);
}

function rememberAnswer(path: string, prop: string, value: string): void {
  const key = lastAnswerKey(path, prop);
  if (lastAnswers.get(key) === value) {
    return;
  }
  if (lastAnswers.size >= LAST_ANSWERS_MAX) {
    lastAnswers.clear();
  }
  lastAnswers.set(key, value);
  assert(lastAnswers.size <= LAST_ANSWERS_MAX, 'rememberAnswer: the remembered answers are bounded');
}

function useComputedAnswer(prop: string): Answer {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!prop) {
      return undefined;
    }
    const sync = () => bump((count) => count + 1);
    const offCache = cache.subscribe(sync);
    const off = onHostChange(sync);
    return () => {
      offCache();
      off();
    };
  }, [prop]);

  const answer = answeredNow(prop);
  useEffect(() => {
    if (answer.pending && answer.path) {
      void currentCache().request(answer.path, prop);
    }
  });

  const host = getHost();
  const value = useStableStyleValue(answer.value, { pending: answer.pending }, [host.projectPath, host.openFilePath, host.selectedId, answer.path, prop]);
  return { ...answer, value };
}

export function useComputedValue(prop: string): string {
  return useComputedAnswer(prop).value;
}

export function useStyleHint(prop: string): string {
  return useComputedAnswer(prop ? `${AUTHORED_PREFIX}${prop}` : '').value;
}

export function useDeclaredValue(prop: string): string {
  return useComputedAnswer(prop ? `${DECLARED_PREFIX}${prop}` : '').value;
}

export function useInheritedSource(prop: string) {
  const label = useComputedAnswer(prop ? `${SOURCE_LABEL_PREFIX}${prop}` : '').value;
  const path = useComputedAnswer(prop ? `${SOURCE_PATH_PREFIX}${prop}` : '').value;
  return label ? { label, ...(path ? { path } : {}) } : undefined;
}

function readCascadeProperty(text: string): CascadeProperty | undefined {
  if (text.length === 0) {
    return undefined;
  }
  try {
    const raw: unknown = JSON.parse(text);
    return parseCascadeProperty(raw);
  } catch {
    return undefined;
  }
}

export function useCascadeTruth(props: readonly string[]): ReadonlyMap<string, CascadeProperty> {
  const [, bump] = useState(0);
  useEffect(() => {
    const sync = () => bump((tick) => tick + 1);
    const offCache = cache.subscribe(sync);
    const off = onHostChange(sync);
    return () => {
      offCache();
      off();
    };
  }, []);
  const path = hasCanvas() ? selectionKey() : undefined;
  const asked = props.slice(0, CASCADE_PROPERTIES_MAX);
  const reading = path === undefined ? undefined : currentCache();
  const texts = asked.map((prop) => {
    if (path === undefined || reading === undefined) {
      return '';
    }
    learnKey(`${CASCADE_PREFIX}${prop}`);
    const known = reading.read(path, `${CASCADE_PREFIX}${prop}`);
    return known.kind === 'pending' ? '' : (known.answer ?? '');
  });
  useEffect(() => {
    if (path === undefined) {
      return;
    }
    for (const prop of asked) {
      void currentCache().request(path, `${CASCADE_PREFIX}${prop}`);
    }
  });
  const askedKey = asked.join(UNIT_SEPARATOR);
  const textsKey = texts.join(UNIT_SEPARATOR);
  return useMemo(() => cascadeTruthOf(askedKey, textsKey), [askedKey, textsKey]);
}

const UNIT_SEPARATOR = '\u0001';

function cascadeTruthOf(askedKey: string, textsKey: string): ReadonlyMap<string, CascadeProperty> {
  const found = new Map<string, CascadeProperty>();
  if (askedKey.length === 0) {
    return found;
  }
  const names = askedKey.split(UNIT_SEPARATOR);
  const answers = textsKey.split(UNIT_SEPARATOR);
  names.forEach((name, index) => {
    const parsed = readCascadeProperty(answers[index] ?? '');
    if (parsed !== undefined) {
      found.set(name, parsed);
    }
  });
  return found;
}

export function useComputedChoice(prop: string, values: readonly string[]): string {
  const computed = useComputedValue(prop).toLowerCase();
  return computed && values.includes(computed) ? computed : '';
}

export function useHighlight(authored: string, prop: string, values: readonly string[], fallback: string): string {
  const answer = useComputedAnswer(authored || !prop ? '' : prop);
  const computed = answer.value.toLowerCase();
  const known = computed && values.includes(computed) ? computed : '';
  const settled = authored || known || (answer.pending ? '' : fallback);
  const elementKey = getHost().selectedId ?? '';
  const last = useRef({ elementKey, shown: settled || fallback });
  const sameElement = last.current.elementKey === elementKey;
  const held = sameElement && values.includes(last.current.shown) ? last.current.shown : fallback;
  const shown = settled || held;
  useEffect(() => {
    last.current = { elementKey, shown };
  }, [elementKey, shown]);
  return shown;
}
