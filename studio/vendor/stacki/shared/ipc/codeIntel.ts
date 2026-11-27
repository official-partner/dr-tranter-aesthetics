import { assert } from '../core/assert';
import { boolean, count, list, object, optional, pathText, record, text } from '../core/boundary';
import { parseExplorerPath, type ExplorerPath } from './fileExplorer';

export const CODE_INTEL_LIMITS = {
  documentCharsMax: 1024 * 1024,
  completionsMax: 200,
  diagnosticsMax: 200,
  labelCharsMax: 400,
  messageCharsMax: 2_000,
  signatureCharsMax: 4_000,
  documentationCharsMax: 4_000,
  editsMax: 20,
  editCharsMax: 4_000,
  signaturesMax: 12,
  indexFilesMax: 30_000,
  indexDirectoriesMax: 6_000,
  indexDepthMax: 24,
  styleFilesMax: 3_000,
  styleFileBytesMax: 512 * 1024,
  styleBytesMax: 24 * 1024 * 1024,
  styleImportsMax: 200,
  rootFilesMax: 3_000,
  sourceFileBytesMax: 2 * 1024 * 1024,
  projectsMax: 3,
  pendingMax: 16,
  firstRequestTimeoutMs: 60_000,
  requestTimeoutMs: 15_000,
  heapMegabytesMax: 1_024,
  residentMegabytesMax: 1_536,
  idleStopMs: 5 * 60_000,
  restartsMax: 3,
  crashWindowMs: 5 * 60_000,
} as const satisfies Record<string, number>;

export const COMPLETION_KINDS = [
  'component',
  'property',
  'value',
  'variable',
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'keyword',
  'constant',
  'module',
  'file',
  'folder',
  'cssVariable',
  'cssClass',
  'text',
] as const;
export type CompletionKind = (typeof COMPLETION_KINDS)[number];

export const DIAGNOSTIC_SEVERITIES = ['error', 'warning', 'info'] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export type CodeIntelQuery =
  | { readonly kind: 'complete'; readonly position: number; readonly explicit: boolean }
  | { readonly kind: 'resolve'; readonly position: number; readonly entry: CompletionEntryRef }
  | { readonly kind: 'hover'; readonly position: number }
  | { readonly kind: 'signature'; readonly position: number }
  | { readonly kind: 'diagnostics' };

export interface CodeIntelRequest {
  readonly projectPath: string;
  readonly path: ExplorerPath;
  readonly text: string;
  readonly query: CodeIntelQuery;
}

export interface CompletionEntryRef {
  readonly name: string;
  readonly source: string | undefined;
  readonly data: string | undefined;
}

export interface CodeEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface CodeCompletion {
  readonly label: string;
  readonly kind: CompletionKind;
  readonly detail: string | undefined;
  readonly insert: string | undefined;
  readonly cursor: number | undefined;
  readonly boost: number;
  readonly required: boolean;
  readonly color: string | undefined;
  readonly signature: string | undefined;
  readonly documentation: string | undefined;
  readonly edits: readonly CodeEdit[];
  readonly entry: CompletionEntryRef | undefined;
}

export interface CodeCompletions {
  readonly from: number;
  readonly to: number;
  readonly items: readonly CodeCompletion[];
  readonly exclusive: boolean;
  readonly incomplete: boolean;
}

export interface CodeCompletionDetail {
  readonly signature: string | undefined;
  readonly documentation: string | undefined;
  readonly edits: readonly CodeEdit[];
}

export interface CodeDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

export interface CodeHover {
  readonly from: number;
  readonly to: number;
  readonly signature: string | undefined;
  readonly documentation: string | undefined;
}

export interface CodeSignature {
  readonly label: string;
  readonly activeFrom: number;
  readonly activeTo: number;
  readonly documentation: string | undefined;
}

export interface CodeSignatureHelp {
  readonly from: number;
  readonly signatures: readonly CodeSignature[];
  readonly active: number;
}

export type CodeIntelReply =
  | { readonly kind: 'completions'; readonly completions: CodeCompletions }
  | { readonly kind: 'detail'; readonly detail: CodeCompletionDetail }
  | { readonly kind: 'hover'; readonly hover: CodeHover | undefined }
  | { readonly kind: 'signature'; readonly help: CodeSignatureHelp | undefined }
  | { readonly kind: 'diagnostics'; readonly diagnostics: readonly CodeDiagnostic[] }
  | { readonly kind: 'unavailable' };

export const UNAVAILABLE: CodeIntelReply = { kind: 'unavailable' };

function bounded(maximum: number) {
  assert(maximum > 0, 'A text bound is positive');
  return (input: unknown): string => {
    const value = text(input);
    if (value.length > maximum) {
      throw new Error('Code intelligence text exceeds its bound');
    }
    return value;
  };
}

function capped<T>(maximum: number, parse: (input: unknown) => T) {
  assert(maximum > 0, 'A list bound is positive');
  return (input: unknown): T[] => {
    const values = list(parse)(input);
    if (values.length > maximum) {
      throw new Error('Code intelligence list exceeds its bound');
    }
    return values;
  };
}

function member<T extends string>(values: readonly T[], input: unknown): T {
  assert(values.length > 0, 'A choice has values');
  const found = values.find((value) => value === input);
  if (found === undefined) {
    throw new Error('Code intelligence: unknown value');
  }
  return found;
}

const label = bounded(CODE_INTEL_LIMITS.labelCharsMax);
const signatureText = bounded(CODE_INTEL_LIMITS.signatureCharsMax);
const documentationText = bounded(CODE_INTEL_LIMITS.documentationCharsMax);
const messageText = bounded(CODE_INTEL_LIMITS.messageCharsMax);

function parseEntryRef(input: unknown): CompletionEntryRef {
  const source = record(input);
  return {
    name: label(source['name']),
    source: optional(bounded(CODE_INTEL_LIMITS.signatureCharsMax))(source['source']),
    data: optional(bounded(CODE_INTEL_LIMITS.signatureCharsMax))(source['data']),
  };
}

function parseQuery(input: unknown, documentLength: number): CodeIntelQuery {
  assert(documentLength >= 0, 'A document has a length');
  assert(documentLength <= CODE_INTEL_LIMITS.documentCharsMax, 'The document was bounded before its query is read');
  const source = record(input);
  const position = (): number => {
    const value = count(source['position']);
    if (value > documentLength) {
      throw new Error('Code intelligence position is outside the document');
    }
    return value;
  };
  switch (source['kind']) {
    case 'complete':
      return { kind: 'complete', position: position(), explicit: boolean(source['explicit']) };
    case 'resolve':
      return { kind: 'resolve', position: position(), entry: parseEntryRef(source['entry']) };
    case 'hover':
      return { kind: 'hover', position: position() };
    case 'signature':
      return { kind: 'signature', position: position() };
    case 'diagnostics':
      return { kind: 'diagnostics' };
    default:
      throw new Error('Code intelligence: unknown query');
  }
}

export function parseCodeIntelRequest(input: unknown): CodeIntelRequest {
  const source = record(input);
  const document = source['text'];
  if (typeof document !== 'string') {
    throw new Error('Code intelligence: the document is text');
  }
  if (document.length > CODE_INTEL_LIMITS.documentCharsMax) {
    throw new Error('Code intelligence: the document exceeds its bound');
  }
  const path = parseExplorerPath(source['path']);
  if (path === '') {
    throw new Error('Code intelligence: a file is named');
  }
  const query = parseQuery(source['query'], document.length);
  assert(!('position' in query) || query.position <= document.length, 'A question points into its document');
  return { projectPath: pathText(source['projectPath']), path, text: document, query };
}

function parseEdit(input: unknown): CodeEdit {
  const source = record(input);
  const edit = { from: count(source['from']), to: count(source['to']), insert: bounded(CODE_INTEL_LIMITS.editCharsMax)(source['insert']) };
  if (edit.to < edit.from) {
    throw new Error('Code intelligence: an edit keeps its order');
  }
  assert(edit.insert.length <= CODE_INTEL_LIMITS.editCharsMax, 'An edit stays within its bound');
  return edit;
}

const parseEdits = capped(CODE_INTEL_LIMITS.editsMax, parseEdit);

function parseCompletion(input: unknown): CodeCompletion {
  const source = record(input);
  const boost = source['boost'];
  if (typeof boost !== 'number' || !Number.isFinite(boost)) {
    throw new Error('Code intelligence: a boost is a number');
  }
  return {
    label: label(source['label']),
    kind: member(COMPLETION_KINDS, source['kind']),
    detail: optional(label)(source['detail']),
    insert: optional(bounded(CODE_INTEL_LIMITS.editCharsMax))(source['insert']),
    cursor: optional(count)(source['cursor']),
    boost,
    required: boolean(source['required']),
    color: optional(label)(source['color']),
    signature: optional(signatureText)(source['signature']),
    documentation: optional(documentationText)(source['documentation']),
    edits: parseEdits(source['edits']),
    entry: optional(parseEntryRef)(source['entry']),
  };
}

function range(source: Record<string, unknown>): { readonly from: number; readonly to: number } {
  const from = count(source['from']);
  const to = count(source['to']);
  if (to < from) {
    throw new Error('Code intelligence: a range keeps its order');
  }
  assert(from >= 0, 'A range starts inside the document');
  return { from, to };
}

function parseCompletions(input: unknown): CodeCompletions {
  const source = record(input);
  const completions = {
    ...range(source),
    items: capped(CODE_INTEL_LIMITS.completionsMax, parseCompletion)(source['items']),
    exclusive: boolean(source['exclusive']),
    incomplete: boolean(source['incomplete']),
  };
  assert(completions.items.length <= CODE_INTEL_LIMITS.completionsMax, 'An answer lists a bounded number of suggestions');
  assert(completions.from <= completions.to, 'The replaced range keeps its order');
  return completions;
}

function parseDetail(input: unknown): CodeCompletionDetail {
  const source = record(input);
  return {
    signature: optional(signatureText)(source['signature']),
    documentation: optional(documentationText)(source['documentation']),
    edits: parseEdits(source['edits']),
  };
}

const parseHover = object({ from: count, to: count, signature: optional(signatureText), documentation: optional(documentationText) });

function parseHoverValue(input: unknown): CodeHover {
  const hover = parseHover(input);
  return { from: hover.from, to: hover.to, signature: hover.signature, documentation: hover.documentation };
}

function parseSignature(input: unknown): CodeSignature {
  const source = record(input);
  return {
    label: signatureText(source['label']),
    activeFrom: count(source['activeFrom']),
    activeTo: count(source['activeTo']),
    documentation: optional(documentationText)(source['documentation']),
  };
}

function parseSignatureHelp(input: unknown): CodeSignatureHelp {
  const source = record(input);
  return {
    from: count(source['from']),
    signatures: capped(CODE_INTEL_LIMITS.signaturesMax, parseSignature)(source['signatures']),
    active: count(source['active']),
  };
}

function parseDiagnostic(input: unknown): CodeDiagnostic {
  const source = record(input);
  return { ...range(source), severity: member(DIAGNOSTIC_SEVERITIES, source['severity']), message: messageText(source['message']) };
}

export function parseCodeIntelReply(input: unknown): CodeIntelReply {
  const source = record(input);
  switch (source['kind']) {
    case 'completions':
      return { kind: 'completions', completions: parseCompletions(source['completions']) };
    case 'detail':
      return { kind: 'detail', detail: parseDetail(source['detail']) };
    case 'hover':
      return { kind: 'hover', hover: optional(parseHoverValue)(source['hover']) };
    case 'signature':
      return { kind: 'signature', help: optional(parseSignatureHelp)(source['help']) };
    case 'diagnostics':
      return { kind: 'diagnostics', diagnostics: capped(CODE_INTEL_LIMITS.diagnosticsMax, parseDiagnostic)(source['diagnostics']) };
    case 'unavailable':
      return UNAVAILABLE;
    default:
      throw new Error('Code intelligence: unknown reply');
  }
}

assert(CODE_INTEL_LIMITS.requestTimeoutMs <= CODE_INTEL_LIMITS.firstRequestTimeoutMs, 'The first request is given the longest');
