import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';
import type { CanvasTextBreaks, CanvasTextRefusal } from '../../../shared/properties/canvasText';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import { cmsTransport } from '../../ipc/editorEnvironment';
import { noteCanvasRichHistory, noteCanvasTextEditing } from '../../editor/canvasTextFocus';
import type { CanvasEditFormat, CanvasTextEdit } from './canvasTextSource';
import type { BoundTextBlockReason } from '../../editor/boundText';
import { useEffect, useRef, type RefObject } from 'react';
import {
  CANVAS_BLOCKED_LIMIT,
  canvasTextUnfolded,
  parseCanvasTextEvent,
  type CanvasRichEditName,
  type CanvasTextCatalog,
  type CanvasTextRunValue,
} from '../../../shared/properties/canvasText';
import { applyCanvasText, applyCanvasTexts, canvasTextNodes, canvasTextPlans, type CanvasSourceNode } from './canvasTextSource';
import { createCanvasTextOverlay } from './canvasTextOverlay';
import { onCanvasTextRefresh } from './canvasTextRefresh';
import { createCanvasRichSaver, richOwnerOf, type CanvasRichEdit, type CanvasRichSave, type CanvasRichSaveHost, type RichWritten } from './canvasRichSave';
import { reportErrorToast } from '../../ui/errorNotices';
import { canvasSourceCue, clearCanvasSourceCue } from '../../ui/canvasTextSourceCue';
import {
  CANVAS_FOCUS_PATHS_MAX,
  canvasTextFocus,
  parseCanvasTextOverlay,
  parseCanvasTextSelection,
  type CanvasTextBox,
  type CanvasTextSelection,
  type CanvasTextSelectionRange,
} from '../../../shared/properties/canvasTextOverlay';
import { canvasRichPlus, canvasTextSelection, clearCanvasTextSelection, type CanvasFormatAction, type CanvasFormatState } from './canvasTextSelection';
import { canvasTextDraft, clearCanvasTextDraft, canvasTypedText, type CanvasTextDraft } from '../../ui/canvasTextDraft';
import { clearLiveContent, setLiveContent } from '../../ui/liveContent';

export interface CanvasTextDocument {
  readonly projectPath: string;
  readonly file: string;
  readonly source: string;
  readonly nodes: readonly CanvasSourceNode[];
  readonly pathFor: (id: string) => string | undefined;
  readonly apply: (source: string, position: number) => Promise<void>;
  readonly report: (message: string) => void;
  readonly loadContent: (document: CanvasTextDocument) => Promise<readonly CanvasTextEdit[]>;
  readonly components?: unknown;
  readonly focus?: readonly string[] | undefined;
  readonly format?: CanvasTextFormatter | undefined;
  readonly breaks?: ((textPath: string) => { readonly breaks: CanvasTextBreaks; readonly richRoot?: string } | undefined) | undefined;
  readonly richBoxes?: (() => readonly string[]) | undefined;
  readonly settings?: unknown;
}
export interface CanvasTextFormatter {
  readonly states: (textId: string) => CanvasFormatState | undefined;
  readonly apply: (textId: string, selection: { readonly start: number; readonly end: number; readonly value: string }, action: CanvasFormatAction) => boolean;
  readonly breaks?: (textId: string, breaks: CanvasTextBreaks, value: string) => boolean;
  readonly contentOwner?: (textId: string, breaks: CanvasTextBreaks | undefined) => string | undefined;
  readonly content?: (ownerId: string) => string | undefined;
  readonly richText?: (ownerId: string, html: string, bases: readonly string[]) => RichWritten;
}
interface Options {
  readonly document: CanvasTextDocument | undefined;
  readonly frame: RefObject<HTMLIFrameElement>;
  readonly url: string | undefined;
  readonly post: (message: unknown) => void;
  readonly subscribeLoad: (listener: () => void) => () => void;
  readonly translate?: Translator | undefined;
}

export function useCanvasText(options: Options): void {
  const translate = useTranslate();
  const current = useRef(options);
  current.current = { ...options, translate };
  const richRef = useRef<ReturnType<typeof createCanvasRichSaver>>();
  richRef.current ??= createCanvasRichSaver();
  const richSaver = richRef.current;
  const document = options.document;
  const file = document?.file;
  const source = document?.source;
  const components = document?.components;
  const settings = document?.settings;
  useEffect(() => startCanvasText(current, richSaver), [file, source, components, settings, richSaver]);
  const focus = (document?.focus ?? []).join('\n');
  useEffect(() => startCanvasFocus(current, focus), [focus]);
}

function startCanvasFocus(current: RefObject<Options>, focus: string) {
  const paths = focus === '' ? [] : focus.split('\n');
  const message = canvasTextFocus(paths.slice(0, CANVAS_FOCUS_PATHS_MAX));
  const send = () => current.current?.post(message);
  send();
  return current.current?.subscribeLoad(send);
}

function startCanvasText(current: RefObject<Options>, richSaver: ReturnType<typeof createCanvasRichSaver>) {
  const initial = current.current?.document;
  if (!initial) {
    return;
  }
  const session = crypto.randomUUID();
  let disposed = false;
  let catalog: CanvasTextCatalog | undefined;
  let plans: readonly CanvasTextEdit[] = [];
  let revision = 0;
  const overlay = createCanvasTextOverlay({
    target: (key) => plans.find((plan) => plan.target.key === key)?.target,
    post: (message) => current.current?.post(message),
  });
  const send = () => catalog && current.current?.post(catalog);
  const refresh = () => {
    revision = (revision + 1) % 1_000_000;
    const version = revision;
    overlay.closeContent();
    void publishCanvasTextSession(initial, session, version, (ready) => {
      if (!disposed && version === revision) {
        plans = ready.plans;
        catalog = ready.catalog;
        send();
      }
    }).catch((error: unknown) => initial.report(String(error)));
  };
  refresh();
  const unsubscribeContent = cmsTransport.onCmsChanged(refresh);
  const unsubscribeRefresh = onCanvasTextRefresh(refresh);
  const unsubscribe = current.current?.subscribeLoad(send);
  const receive = createCanvasTextReceiver({
    current,
    initial,
    session,
    overlay,
    richSaver,
    plans: () => plans,
  });
  window.addEventListener('message', receive);
  return () => {
    disposed = true;
    overlay.close();
    clearCanvasTextDraft(session);
    clearCanvasTextSelection(session);
    clearLiveContent(session);
    unsubscribeContent();
    unsubscribeRefresh();
    clearCanvasSourceCue(session);
    if (catalog) {
      current.current?.post({ ...catalog, session: crypto.randomUUID(), targets: [] });
    }
    unsubscribe?.();
    window.removeEventListener('message', receive);
  };
}

interface CanvasTextReceiverOptions {
  readonly current: RefObject<Options>;
  readonly initial: CanvasTextDocument;
  readonly session: string;
  readonly overlay: ReturnType<typeof createCanvasTextOverlay>;
  readonly richSaver: ReturnType<typeof createCanvasRichSaver>;
  readonly plans: () => readonly CanvasTextEdit[];
}

function createCanvasTextReceiver(options: CanvasTextReceiverOptions) {
  let busy = false;
  const takeover: Takeover = { key: undefined, linking: false };
  const nodes = new Map(canvasTextNodes(options.initial.nodes).map(({ node }) => [node.id ? options.initial.pathFor(node.id) : undefined, node]));
  return (event: MessageEvent<unknown>) => {
    const message = canvasTextSessionMessage(event, options);
    if (!message) {
      return;
    }
    if (message.type === 'avb:text-active' || message.type === 'avb:text-inactive') {
      noteCanvasTextEditing(message.type === 'avb:text-active' ? 'active' : 'inactive');
      noteCanvasRichHistory(
        message.type === 'avb:text-active' && message.blocks === true
          ? (step) => options.current.current?.post({ type: 'avb:rich-history', session: options.session, step })
          : undefined,
      );
      options.overlay.receive(message);
      showSourceCue(message, options);
      if (!busy) {
        clearCanvasTextDraft(options.session);
      }
      if (message.type === 'avb:text-inactive') {
        clearLiveContent(options.session);
      }
      if (message.type === 'avb:text-inactive' && !takeover.linking) {
        takeover.key = undefined;
        clearCanvasTextSelection(options.session);
      }
      return;
    }
    if (message.type === 'avb:rich-plus') {
      showRichPlus(message, options);
      return;
    }
    if (busy || message.key === takeover.key) {
      return;
    }
    if (message.type === 'avb:text-selection') {
      receiveCanvasSelection(message, { ...options, nodes, takeover });
      return;
    }
    if (message.type === 'avb:rich-draft') {
      options.richSaver.opened(richEditOf(message.edit), options.current.current?.document);
      publishLiveContent(richEditOf(message.edit), message, options);
      return;
    }
    const plan = options.plans().find((entry) => entry.target.key === message.key);
    if (!plan) {
      return;
    }
    if (message.type === 'avb:text-draft') {
      publishCanvasDraft(plan, nodes.get(plan.target.path), message.value, options);
      return;
    }
    if (savedWithBreaks(plan, message, { ...options, nodes })) {
      return;
    }
    busy = true;
    const draft = canvasTextDraft.get();
    void saveCanvasText(plan, message, options)
      .catch((error: unknown) => options.initial.report(String(error)))
      .finally(() => {
        busy = false;
        if (canvasTextDraft.get() === draft) {
          clearCanvasTextDraft(options.session);
        }
      });
  };
}

function publishLiveContent(edit: CanvasRichEdit, message: { readonly html: string; readonly caret: readonly number[] }, options: CanvasTextReceiverOptions) {
  const document = options.current.current?.document;
  const nodeID = document === undefined ? undefined : richOwnerOf(edit, document);
  if (nodeID !== undefined) {
    setLiveContent({ owner: options.session, nodeID, html: message.html, caret: message.caret });
  }
}

function wordsOf(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return Array.from(template.content.childNodes, (node) => node.textContent ?? '').join('\n');
}

function richEditOf(name: CanvasRichEditName) {
  return { edit: name.id, file: name.file, root: name.root, breaks: name.breaks };
}

function saveRichText(save: CanvasRichSave, options: CanvasTextReceiverOptions) {
  const answer = (type: 'avb:rich-refused' | 'avb:rich-settled', edit: string) => options.current.current?.post({ type, edit });
  const host: CanvasRichSaveHost = {
    document: () => options.current.current?.document,
    unchanged: (saved) => answer('avb:rich-settled', saved.edit),
    refused: (why, saved) => {
      const translate = options.current.current?.translate ?? ENGLISH_TRANSLATE;
      const message = translate(why === 'conflict' ? 'preview.text.sourceChanged' : 'preview.text.cannotFormat');
      const report = (options.current.current?.document ?? options.initial).report;
      if (why === 'conflict') {
        reportErrorToast(message, [{ label: translate('structure.menu.copy'), run: () => navigator.clipboard.writeText(wordsOf(saved.html)) }]);
      } else {
        report(message);
      }
      answer('avb:rich-refused', saved.edit);
    },
    wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  };
  void options.richSaver.save(save, host).catch((error: unknown) => {
    options.initial.report(String(error));
    answer('avb:rich-refused', save.edit);
  });
}

function showRichPlus(message: { readonly session: string; readonly rect?: CanvasTextBox }, options: CanvasTextReceiverOptions) {
  const frame = options.current.current?.frame.current;
  if (message.rect === undefined || !frame) {
    canvasRichPlus.set(undefined);
    return;
  }
  const origin = frame.getBoundingClientRect();
  const scale = frame.clientWidth > 0 ? origin.width / frame.clientWidth : 1;
  const canvas = frame.closest('.frame-sized')?.parentElement?.getBoundingClientRect();
  canvasRichPlus.set({
    session: options.session,
    leftMin: canvas?.left ?? 0,
    box: { x: origin.left + message.rect.x * scale, y: origin.top + message.rect.y * scale, w: message.rect.w * scale, h: message.rect.h * scale },
    hold: () => options.current.current?.post({ type: 'avb:rich-hold', session: options.session }),
    resume: () => {
      options.current.current?.frame.current?.focus();
      options.current.current?.post({ type: 'avb:rich-resume', session: options.session });
    },
    choose: (choice) => {
      options.current.current?.frame.current?.focus();
      options.current.current?.post({ type: 'avb:rich-block', session: options.session, choice });
    },
  });
}

function savedWithBreaks(
  plan: CanvasTextEdit,
  message: CanvasTextRunValue & { readonly also?: readonly CanvasTextRunValue[] },
  options: CanvasTextReceiverOptions & { readonly nodes: ReadonlyMap<string | undefined, CanvasSourceNode> },
): boolean {
  const breaks = plan.target.breaks;
  if (breaks === undefined || message.also !== undefined || !message.value.includes('\n')) {
    return false;
  }
  const node = options.nodes.get(plan.target.path);
  const written =
    node?.kind === 'text' && node.id !== undefined && options.initial.format?.breaks?.(node.id, breaks, canvasTypedText(plan.target.value, message.value));
  if (written !== true) {
    options.initial.report((options.current.current?.translate ?? ENGLISH_TRANSLATE)('preview.text.cannotFormat'));
  }
  return true;
}

function saveCanvasText(
  plan: CanvasTextEdit,
  message: CanvasTextRunValue & { readonly also?: readonly CanvasTextRunValue[] },
  options: CanvasTextReceiverOptions,
) {
  if (!message.also) {
    return plan.apply(message.value);
  }
  const edits = [message, ...message.also].flatMap(({ key, value }) => {
    const edit = options.plans().find((entry) => entry.target.key === key);
    return edit?.plan ? [{ plan: edit.plan, value: canvasTypedText(edit.target.value, value) }] : [];
  });
  if (edits.length !== message.also.length + 1) {
    options.initial.report((options.current.current?.translate ?? ENGLISH_TRANSLATE)('preview.text.pageChanged'));
    return Promise.resolve();
  }
  const position = Math.min(...edits.map((edit) => edit.plan.start));
  return options.initial.apply(applyCanvasTexts(options.initial.source, edits), position);
}

function publishCanvasDraft(plan: CanvasTextEdit, node: CanvasSourceNode | undefined, value: string, options: CanvasTextReceiverOptions) {
  const scope = {
    session: options.session,
    projectPath: options.initial.projectPath,
    file: options.initial.file,
    value,
  };
  if (plan.prop) {
    const { nodeID, name } = plan.prop;
    canvasTextDraft.set({
      ...scope,
      kind: 'prop',
      nodeID,
      prop: name,
      value: plan.prop.value(value),
      typed: value,
    });
    return;
  }
  if (node?.id && node.value !== undefined) {
    canvasTextDraft.set({ ...scope, kind: 'text', nodeID: node.id, sourceValue: node.value });
  }
}

function canvasTextSessionMessage(event: MessageEvent<unknown>, options: CanvasTextReceiverOptions) {
  const host = options.current.current;
  const message = canvasTextMessage(event, host ?? undefined);
  if (!message || !host) {
    return undefined;
  }
  if (message.type === 'avb:text-refused') {
    const translate = options.current.current?.translate ?? ENGLISH_TRANSLATE;
    options.initial.report(blockedRefusal(message, options.plans(), options.initial.file, translate) ?? refusalText(message, translate));
    return undefined;
  }
  if (message.type === 'avb:rich-save') {
    saveRichText({ ...richEditOf(message.edit), html: message.html, base: message.base }, options);
    return undefined;
  }
  const stale = message.session !== options.session || host.document?.source !== options.initial.source || host.document.file !== options.initial.file;
  if (stale) {
    if (message.type === 'avb:text-save') {
      const translate = host.translate ?? ENGLISH_TRANSLATE;
      options.initial.report(translate('preview.text.sourceChanged'));
    }
    return undefined;
  }
  return message;
}

function canvasTextMessage(event: MessageEvent<unknown>, host: Options | undefined) {
  if (!host?.url || event.source !== host.frame.current?.contentWindow || event.origin !== new URL(host.url).origin) {
    return undefined;
  }
  try {
    return parseCanvasTextEvent(event.data) ?? parseCanvasTextOverlay(event.data) ?? parseCanvasTextSelection(event.data);
  } catch {
    return undefined;
  }
}

async function publishCanvasTextSession(
  document: CanvasTextDocument,
  session: string,
  revision: number,
  publish: (ready: { readonly plans: readonly CanvasTextEdit[]; readonly catalog: CanvasTextCatalog }) => void,
) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document.source));
  const checksum = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const literal = canvasTextPlans(document.source, document.nodes, document.pathFor);
  const plans: readonly CanvasTextEdit[] = [
    ...literal.map((plan) => ({
      target: withBreaks(plan.target, document.breaks?.(plan.target.path)),
      plan,
      apply: (value: string) => {
        const typed = canvasTypedText(plan.target.value, value);
        return document.apply(applyCanvasText(document.source, plan, typed), plan.start);
      },
    })),
  ];
  const boxes = document.richBoxes?.().slice(0, CANVAS_BLOCKED_LIMIT) ?? [];
  const catalog: CanvasTextCatalog = {
    type: 'avb:text-catalog',
    session,
    file: document.file,
    checksum,
    targets: plans.map((plan) => plan.target).slice(0, 2_000),
    ...(boxes.length === 0 ? {} : { boxes }),
  };
  publish({ plans, catalog });
  const content = await document.loadContent(document);
  if (content.length) {
    const refreshed = content.map((plan) => ({
      ...plan,
      target: plan.bound === undefined ? { ...plan.target, key: `cms:${revision}:${plan.target.key}` } : plan.target,
    }));
    const claimed = new Set(refreshed.filter((plan) => plan.bound !== undefined).map((plan) => plan.target.path));
    const kept = plans.filter((plan) => !claimed.has(plan.target.path));
    const combined = [...kept, ...refreshed].slice(0, 2_000);
    const editable = combined.filter((plan) => plan.bound?.kind !== 'blocked');
    const blocked = combined.filter((plan) => plan.bound?.kind === 'blocked').slice(0, CANVAS_BLOCKED_LIMIT);
    publish({
      plans: combined,
      catalog: {
        ...catalog,
        targets: editable.map((plan) => plan.target),
        ...(blocked.length === 0
          ? {}
          : {
              blocked: blocked.map((plan) => ({
                key: plan.target.key,
                path: plan.target.path,
                ...(plan.target.scope === undefined ? {} : { scope: plan.target.scope }),
              })),
            }),
      },
    });
  }
}

function withBreaks<Target extends { readonly breaks?: CanvasTextBreaks; readonly richRoot?: string }>(
  target: Target,
  breaking: { readonly breaks: CanvasTextBreaks; readonly richRoot?: string } | undefined,
): Target {
  return breaking === undefined ? target : { ...target, ...breaking };
}

function showSourceCue(
  message: { readonly type: string; readonly session: string; readonly key?: string; readonly rect?: CanvasTextBox },
  options: CanvasTextReceiverOptions,
) {
  if (message.type !== 'avb:text-active' || message.key === undefined) {
    clearCanvasSourceCue(options.session);
    return;
  }
  const bound = options.plans().find((entry) => entry.target.key === message.key)?.bound;
  const frame = options.current.current?.frame.current;
  if (bound?.kind !== 'source' || message.rect === undefined || !frame) {
    clearCanvasSourceCue(options.session);
    return;
  }
  const origin = frame.getBoundingClientRect();
  const scale = frame.clientWidth > 0 ? origin.width / frame.clientWidth : 1;
  canvasSourceCue.set({
    session: options.session,
    expression: bound.expression,
    file: bound.file,
    uses: bound.uses,
    box: { x: origin.left + message.rect.x * scale, y: origin.top + message.rect.y * scale, w: message.rect.w * scale, h: message.rect.h * scale },
  });
}

function blockedRefusal(
  message: { readonly reason?: CanvasTextRefusal | undefined; readonly key?: string | undefined },
  plans: readonly CanvasTextEdit[],
  pageFile: string,
  translate: Translator,
): string | undefined {
  if (message.reason !== 'source-blocked') {
    return undefined;
  }
  const bound = plans.find((plan) => plan.target.key === message.key)?.bound;
  if (bound?.kind !== 'blocked') {
    return undefined;
  }
  const file = bound.file === '' ? pageFile : bound.file;
  const place = bound.line === undefined ? file : `${file}:${bound.line}`;
  return translate(BLOCKED_KEYS[bound.reason], { file: place, path: bound.expression, name: bound.name ?? bound.expression });
}

interface Takeover {
  key: string | undefined;
  linking: boolean;
}

interface CanvasSelectionOptions extends CanvasTextReceiverOptions {
  readonly nodes: ReadonlyMap<string | undefined, CanvasSourceNode>;
  readonly takeover: Takeover;
}

function receiveCanvasSelection(message: CanvasTextSelection, options: CanvasSelectionOptions) {
  const { initial, session, takeover } = options;
  const plan = options.plans().find((entry) => entry.target.key === message.key);
  const range = message.range;
  const format = plan && editFormat(plan, options.nodes, initial.format);
  const states = format?.states();
  const frame = options.current.current?.frame.current;
  if (!range || !plan || !format || !states || !frame) {
    clearCanvasTextSelection(session);
    return;
  }
  const typed = () => {
    const draft = canvasTextDraft.get();
    return draft?.session === session && draftOf(plan, draft, options.nodes) ? draftTyped(draft) : plan.target.value;
  };
  const takeOver = () => {
    const value = typed();
    takeover.key = message.key;
    options.current.current?.post({ type: 'avb:text-close', session, action: 'cancel' });
    const start = canvasTextUnfolded(value, range.start, 'start');
    const end = canvasTextUnfolded(value, range.end, 'end');
    return typedSelection(plan, { start: start ?? 0, end: end ?? 0, value });
  };
  const release = () => {
    takeover.linking = false;
    takeover.key = undefined;
    clearCanvasTextSelection(session);
  };
  let held: ReturnType<typeof takeOver> | undefined;
  canvasTextSelection.set({
    session,
    bubble: windowBubble(frame, range.rect),
    states,
    press: (action) => {
      const selection = takeOver();
      if (selection.start >= selection.end || !format.apply(selection, action)) {
        initial.report((options.current.current?.translate ?? ENGLISH_TRANSLATE)('preview.text.cannotFormat'));
      }
      release();
    },
    beginLink: () => {
      takeover.linking = true;
      held = takeOver();
    },
    endLink: (url) => {
      const selection = held;
      held = undefined;
      release();
      if (!selection) {
        return;
      }
      const linkable = selection.start < selection.end;
      if (url !== undefined && linkable && format.apply(selection, { kind: 'link', url })) {
        return;
      }
      if (selection.value !== plan.target.value) {
        void plan.apply(selection.value).catch((error: unknown) => initial.report(String(error)));
      }
    },
  });
}

function editFormat(
  plan: CanvasTextEdit,
  nodes: ReadonlyMap<string | undefined, CanvasSourceNode>,
  format: CanvasTextFormatter | undefined,
): CanvasEditFormat | undefined {
  if (plan.format) {
    return plan.format;
  }
  if (plan.target.key.startsWith('cms:')) {
    return undefined;
  }
  const node = nodes.get(plan.target.path);
  const textId = node?.kind === 'text' ? node.id : undefined;
  if (!textId || !format) {
    return undefined;
  }
  return {
    states: () => format.states(textId),
    apply: (selection, action) => format.apply(textId, selection, action),
  };
}

function typedSelection(plan: CanvasTextEdit, selection: { readonly start: number; readonly end: number; readonly value: string }) {
  if (plan.prop) {
    return selection;
  }
  const value = canvasTypedText(plan.target.value, selection.value);
  const dropped = /^[ \t\n\r\f]*/.exec(selection.value)?.[0].length ?? 0;
  const shift = dropped - (value.startsWith(' ') && dropped > 0 ? 1 : 0);
  const clamp = (offset: number) => Math.min(Math.max(offset - shift, 0), value.length);
  return { start: clamp(selection.start), end: clamp(selection.end), value };
}

function draftOf(plan: CanvasTextEdit, draft: CanvasTextDraft, nodes: ReadonlyMap<string | undefined, CanvasSourceNode>): boolean {
  if (draft.kind === 'prop') {
    return draft.nodeID === plan.prop?.nodeID && draft.prop === plan.prop.name;
  }
  return draft.nodeID === nodes.get(plan.target.path)?.id;
}

function draftTyped(draft: CanvasTextDraft): string {
  return draft.kind === 'prop' ? draft.typed : draft.value;
}

function windowBubble(frame: HTMLIFrameElement, rect: CanvasTextSelectionRange['rect']) {
  const box = frame.getBoundingClientRect();
  const scale = frame.clientWidth > 0 ? box.width / frame.clientWidth : 1;
  return {
    x: box.left + (rect.x + rect.w / 2) * scale,
    top: box.top + rect.y * scale,
    bottom: box.top + (rect.y + rect.h) * scale,
  };
}

const REFUSAL_KEYS: Readonly<Record<CanvasTextRefusal, MessageKey>> = {
  'waiting-render': 'preview.text.waitingRender',
  'selection-reaches': 'preview.text.selectionReaches',
  unsafe: 'preview.text.unsafe',
  'page-changed': 'preview.text.pageChanged',
  'source-blocked': 'preview.text.source.blocked.computed',
};

const BLOCKED_KEYS: Readonly<Record<BoundTextBlockReason, MessageKey>> = {
  ambiguous: 'preview.text.source.blocked.ambiguous',
  call: 'preview.text.source.blocked.call',
  computed: 'preview.text.source.blocked.computed',
  concatenation: 'preview.text.source.blocked.concatenation',
  duplicate: 'preview.text.source.blocked.duplicate',
  loop: 'preview.text.source.blocked.loop',
  missing: 'preview.text.source.blocked.missing',
  multiline: 'preview.text.source.blocked.multiline',
  mutable: 'preview.text.source.blocked.mutable',
  'not-text': 'preview.text.source.blocked.notText',
  prop: 'preview.text.source.blocked.prop',
  runtime: 'preview.text.source.blocked.computed',
  template: 'preview.text.source.blocked.template',
  unreadable: 'preview.text.source.blocked.unreadable',
  unsupported: 'preview.text.source.blocked.unsupported',
};

function refusalText(message: { readonly message: string; readonly reason?: CanvasTextRefusal | undefined }, translate: Translator): string {
  return message.reason === undefined ? message.message : translate(REFUSAL_KEYS[message.reason]);
}
