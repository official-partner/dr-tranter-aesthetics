
import type { CanvasBoundText, CanvasSourceNode, CanvasTextEdit } from '../../features/preview/canvasTextSource';
import { canvasTextTarget } from '../../features/preview/canvasTextSource';
import type { CanvasTextDocument } from '../../features/preview/useCanvasText';
import { requestCanvasTextRefresh } from '../../features/preview/canvasTextRefresh';
import { CANVAS_TEXT_LIMIT } from '../../../shared/properties/canvasText';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import {
  BOUND_TEXT_LIMITS,
  boundLoopOf,
  expressionInLoops,
  parseBoundPath,
  resolveBoundList,
  resolveBoundText,
  rewriteBoundText,
  type BoundTextBlock,
  type BoundTextEnvironment,
  type BoundTextLoop,
  type BoundTextModule,
  type BoundTextSite,
} from '../../editor/boundText';
import { canvasTypedText } from '../../ui/canvasTextDraft';
import { reportActionToast } from '../../ui/errorNotices';

export interface BoundTextHost {
  readonly readModule: (fromFile: string, spec: string) => Promise<BoundTextModule | undefined>;
  readonly readFile: (file: string) => Promise<string | undefined>;
  readonly writeModule?: (write: { readonly file: string; readonly before: string; readonly after: string }) => Promise<void>;
  readonly undo?: () => Promise<void>;
}

export interface BoundTextWords {
  readonly saved: (path: string, file: string) => string;
  readonly undo: string;
  readonly sourceChanged: string;
}

const CANDIDATES_MAX = 200;
const TARGETS_MAX = 400;

interface Candidate {
  readonly node: CanvasSourceNode;
  readonly parent: CanvasSourceNode;
  readonly expression: string;
  readonly loops: readonly { readonly item: string; readonly list: string }[];
}

interface Resolved {
  readonly candidate: Candidate;
  readonly suffix: string;
  readonly path: string;
  readonly outcome: { readonly ok: true; readonly site: BoundTextSite } | { readonly ok: false; readonly block: BoundTextBlock };
}

export async function canvasBoundEdits(document: CanvasTextDocument, host: BoundTextHost, words: BoundTextWords): Promise<CanvasTextEdit[]> {
  const reads = new Map<string, Promise<BoundTextModule | undefined>>();
  const environment: BoundTextEnvironment = {
    page: { file: document.file, text: document.source },
    readModule: (fromFile, spec) => {
      const key = `${fromFile}\u0000${spec}`;
      const known = reads.get(key) ?? host.readModule(fromFile, spec);
      reads.set(key, known);
      return known;
    },
  };
  const resolved: Resolved[] = [];
  for (const candidate of candidatesOf(document.source, document.nodes).slice(0, CANDIDATES_MAX)) {
    resolved.push(...(await resolveCandidate(environment, candidate, TARGETS_MAX - resolved.length)));
    if (resolved.length >= TARGETS_MAX) {
      break;
    }
  }
  const uses = new Map<string, number>();
  for (const entry of resolved) {
    if (entry.outcome.ok) {
      const key = siteKey(entry.outcome.site);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const edits: CanvasTextEdit[] = [];
  for (const entry of withoutRepeats(resolved)) {
    const edit = entry.outcome.ok ? sourceEdit(document, host, words, entry, entry.outcome.site, uses) : blockedEdit(document, entry, entry.outcome.block);
    if (edit !== undefined) {
      edits.push(edit);
    }
  }
  assert(edits.length <= TARGETS_MAX, 'Bound text stays within its target bound');
  return edits;
}

const NO_LOOPS: Candidate['loops'] = [];
const siteKey = (site: BoundTextSite): string => `${site.file}\u0000${site.start}`;

function candidatesOf(source: string, nodes: readonly CanvasSourceNode[]): Candidate[] {
  const found: Candidate[] = [];
  const stack: { readonly node: CanvasSourceNode; readonly parent: CanvasSourceNode | undefined; readonly loops: Candidate['loops'] | undefined }[] = nodes
    .map((node) => ({ node, parent: undefined, loops: NO_LOOPS }))
    .reverse();
  for (let visited = 0; stack.length > 0 && visited < 20_000; visited++) {
    const entry = stack.pop();
    assert(entry !== undefined, 'The candidate walk has an entry');
    const { node, parent, loops } = entry;
    const own = node.kind === 'map' ? boundLoopOf(node.head ?? '') : undefined;
    const inside = loops === undefined || (node.kind === 'map' && own === undefined) ? undefined : own === undefined ? loops : [...loops, own];
    if (node.kind === 'expr' && loops !== undefined && parent !== undefined && (parent.kind === 'element' || parent.kind === 'component')) {
      const expression = node.start === undefined || node.end === undefined ? '' : source.slice(node.start + 1, node.end - 1).trim();
      if (parseBoundPath(expression) !== undefined) {
        found.push({ node, parent, expression, loops });
      }
    }
    for (const child of [...(node.children ?? [])].reverse()) {
      stack.push({ node: child, parent: node, loops: inside });
    }
  }
  return found;
}

async function resolveCandidate(environment: BoundTextEnvironment, candidate: Candidate, budget: number): Promise<Resolved[]> {
  const parsed = parseBoundPath(candidate.expression);
  const usesLoop = parsed !== undefined && candidate.loops.some((loop) => loop.item === parsed.root);
  if (candidate.loops.length > 0 && !usesLoop) {
    return [refused(candidate, { reason: 'duplicate', file: '', detail: 'Every pass of the loop prints the same words.' })];
  }
  const combinations: BoundTextLoop[][] = [];
  const failures: { readonly block: BoundTextBlock | undefined }[] = [];
  await enumerate(environment, candidate.loops, [], combinations, Math.min(budget, BOUND_TEXT_LIMITS.itemsMax), failures);
  const results: Resolved[] = [];
  for (const combination of combinations) {
    const path = expressionInLoops(candidate.expression, combination);
    const suffix = combination.map((loop) => `~${loop.index}`).join('');
    results.push({ candidate, suffix, path, outcome: await resolveBoundText(environment, path) });
  }
  const editable = results.filter((entry) => entry.outcome.ok);
  const first = results.find((entry) => !entry.outcome.ok)?.outcome;
  const block = first !== undefined && !first.ok ? first.block : failures[0]?.block;
  return [...editable, ...(block === undefined || (editable.length > 0 && results.length === editable.length) ? [] : [refused(candidate, block)])];
}

function refused(candidate: Candidate, block: BoundTextBlock): Resolved {
  return { candidate, suffix: '', path: candidate.expression, outcome: { ok: false, block } };
}

async function enumerate(
  environment: BoundTextEnvironment,
  loops: Candidate['loops'],
  chosen: readonly BoundTextLoop[],
  into: BoundTextLoop[][],
  budget: number,
  failure: { readonly block: BoundTextBlock | undefined }[],
): Promise<void> {
  const depth = chosen.length;
  assert(depth <= LIMITS.treeDepthMax, 'Loops nest within the tree depth bound');
  const loop = loops[depth];
  if (loop === undefined) {
    into.push([...chosen]);
    return;
  }
  const counted = await resolveBoundList(environment, expressionInLoops(loop.list, chosen));
  if (!counted.ok) {
    failure.push({ block: counted.block });
    return;
  }
  for (let index = 0; index < counted.count && into.length < budget; index++) {
    await enumerate(environment, loops, [...chosen, { item: loop.item, list: loop.list, index }], into, budget, failure);
  }
}

function withoutRepeats(resolved: readonly Resolved[]): Resolved[] {
  const counts = new Map<string, number>();
  const wordsKey = (entry: Resolved & { readonly outcome: { readonly ok: true; readonly site: BoundTextSite } }) =>
    `${entry.candidate.node.id ?? ''}\u0000${entry.outcome.site.value.trim()}`;
  for (const entry of resolved) {
    if (entry.outcome.ok && entry.suffix !== '') {
      const key = wordsKey({ ...entry, outcome: entry.outcome });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const kept: Resolved[] = [];
  const reported = new Set<string>();
  for (const entry of resolved) {
    if (!entry.outcome.ok || entry.suffix === '' || (counts.get(wordsKey({ ...entry, outcome: entry.outcome })) ?? 0) === 1) {
      kept.push(entry);
      continue;
    }
    const id = entry.candidate.node.id ?? '';
    if (!reported.has(id)) {
      reported.add(id);
      kept.push(refused(entry.candidate, { reason: 'duplicate', file: '', detail: 'Several items print the same words.' }));
    }
  }
  return kept;
}

function sourceEdit(
  document: CanvasTextDocument,
  host: BoundTextHost,
  words: BoundTextWords,
  entry: Resolved,
  site: BoundTextSite,
  uses: ReadonlyMap<string, number>,
): CanvasTextEdit | undefined {
  const { candidate } = entry;
  if (!site.value.trim() || site.value.length > CANVAS_TEXT_LIMIT) {
    return undefined;
  }
  const target = canvasTextTarget(candidate.node, candidate.parent, site.value, 'Edit source', document.pathFor);
  if (target === undefined) {
    return undefined;
  }
  const bound: CanvasBoundText = {
    kind: 'source',
    expression: entry.path,
    file: site.file === document.file ? '' : site.file,
    uses: uses.get(siteKey(site)) ?? 1,
  };
  const editable = site.file === document.file || host.writeModule !== undefined;
  return {
    target: { ...target, key: `${target.key}${entry.suffix}` },
    bound: editable ? bound : { kind: 'blocked', expression: entry.path, file: site.file, reason: 'unsupported' },
    apply: (value) => commitSource({ document, host, words, site, expression: entry.path, value: canvasTypedText(site.value, value) }),
  };
}

function blockedEdit(document: CanvasTextDocument, entry: Resolved, block: BoundTextBlock): CanvasTextEdit | undefined {
  const { candidate } = entry;
  const key = document.pathFor(candidate.node.id ?? '');
  const target = canvasTextTarget(candidate.node, candidate.parent, entry.path, 'Edit source', document.pathFor);
  if (key === undefined || target === undefined || entry.suffix !== '') {
    return undefined;
  }
  return {
    target: { ...target, value: '' },
    bound: {
      kind: 'blocked',
      expression: entry.path,
      file: block.file,
      reason: block.reason,
      ...(block.line === undefined ? {} : { line: block.line }),
      ...(block.name === undefined ? {} : { name: block.name }),
    },
    apply: () => Promise.reject(new Error(block.detail)),
  };
}

interface Commit {
  readonly document: CanvasTextDocument;
  readonly host: BoundTextHost;
  readonly words: BoundTextWords;
  readonly site: BoundTextSite;
  readonly expression: string;
  readonly value: string;
}

async function commitSource(commit: Commit): Promise<void> {
  const { document, host, words, site, value } = commit;
  if (value === site.value) {
    return;
  }
  if (site.file === document.file) {
    const next = rewriteBoundText(document.source, site, value);
    if (next === undefined) {
      throw new Error(words.sourceChanged);
    }
    await document.apply(next, site.start);
  } else {
    const write = host.writeModule;
    assert(write !== undefined, 'A text is edited in another file only when the host can write it');
    const before = await host.readFile(site.file);
    const after = before === undefined ? undefined : rewriteBoundText(before, site, value);
    if (before === undefined || after === undefined) {
      throw new Error(words.sourceChanged);
    }
    await write({ file: site.file, before, after });
    requestCanvasTextRefresh();
  }
  const undo = host.undo;
  reportActionToast(
    words.saved(commit.expression, site.file === document.file ? document.file : site.file),
    'success',
    undo === undefined ? [] : [{ label: words.undo, run: undo }],
  );
}

export interface BoundPropText {
  readonly value: string;
  readonly bound: CanvasBoundText;
  readonly apply: (typed: string) => Promise<void>;
}

export function boundPropReader(
  document: CanvasTextDocument,
  host: BoundTextHost,
  words: BoundTextWords,
): (expression: string) => Promise<BoundPropText | undefined> {
  const environment: BoundTextEnvironment = {
    page: { file: document.file, text: document.source },
    readModule: (fromFile, spec) => host.readModule(fromFile, spec),
  };
  return async (expression) => {
    const path = expression.trim().replace(/^\{\s*([\s\S]*?)\s*\}$/, '$1');
    const outcome = await resolveBoundText(environment, path);
    if (!outcome.ok) {
      return refusedProp(path, outcome.block);
    }
    const { site } = outcome;
    if (!site.value.trim() || site.value.length > CANVAS_TEXT_LIMIT) {
      return undefined;
    }
    if (site.file !== document.file && host.writeModule === undefined) {
      return refusedProp(path, { reason: 'unsupported', file: site.file, detail: 'The host cannot write this file.' });
    }
    return {
      value: site.value,
      bound: { kind: 'source', expression: path, file: site.file === document.file ? '' : site.file, uses: 1 },
      apply: (typed) => commitSource({ document, host, words, site, expression: path, value: canvasTypedText(site.value, typed) }),
    };
  };
}

function refusedProp(expression: string, block: BoundTextBlock): BoundPropText {
  return {
    value: '',
    bound: {
      kind: 'blocked',
      expression,
      file: block.file,
      reason: block.reason,
      ...(block.line === undefined ? {} : { line: block.line }),
      ...(block.name === undefined ? {} : { name: block.name }),
    },
    apply: () => Promise.reject(new Error(block.detail)),
  };
}
