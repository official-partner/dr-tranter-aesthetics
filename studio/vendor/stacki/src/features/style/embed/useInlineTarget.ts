
import { useTranslate, useTranslateDescribed } from '../../../lib/i18n/useTranslate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assert } from '../../../../shared/core/assert';
import { readInlineStyle } from '../../../../shared/engine/inlineStyle';
import type { StyleDeclaration } from '../../../../shared/engine/intent';
import { findNode, getHost, onHostChange, type HostNode } from '../model/host';
import { writtenValue } from '../model/lengthUnit';
import { componentSource } from '../model/componentSourceCache';
import { componentStyleText, writeComponentStyle } from '../model/componentStyleWrite';
import { readStyleBranches, writeStyleBranch, type StyleBranch } from '../model/inlineBranches';
import {
  INLINE_STYLE_SELECTOR,
  chipInlineStyle,
  inlineChipShown,
  inlineDeclaration,
  inlineEditBase,
  heldUntilTaken,
  inlineStyleOf,
  inlineStyleWrite,
  plainStyleBranch,
  plainStyleCommit,
  selectedBranch,
  type HeldInlineWrite,
  type InlineStyle,
} from '../model/inlineTarget';
import type { ElementSnapshot } from '../model/styleTypes';
import type { InlineResolveInput } from '../model/resolved';
import { usePseudoTarget } from './editorModel';
import type { LiveSetProp, SetProp } from './EditorBasics';
import type { InlineBranchView } from './InlineBranchEditor';
import type { StyleCardProps } from './QueryForms';
import { inlineDefault } from '../model/inlineDefault';

export interface InlineChip {
  readonly state: 'editable' | 'code';
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onDeselect: () => void;
  readonly onClear: (() => void) | undefined;
}

export type InlineCodeView =
  { readonly kind: 'branches'; readonly view: InlineBranchView } | { readonly kind: 'readonly'; readonly code: string; readonly reason: string };

export function useInlineState() {
  const node = useSelectedHostNode();
  const attribute = node?.props?.['style'];
  const ownStyle = useMemo(() => inlineStyleOf(attribute === undefined ? undefined : { props: { style: attribute } }), [attribute]);
  const [pickedFor, setPickedFor] = useState<string | undefined>(undefined);
  const [branchKey, setBranchKey] = useState<string | undefined>(undefined);
  const nodeId = node?.id;
  const writable = getHost().setInlineStyle !== undefined;
  const pseudo = usePseudoTarget() !== undefined;
  const instance = node?.kind === 'component';
  return { ownStyle, nodeId, pickedFor, setPickedFor, branchKey, setBranchKey, writable, pseudo, instance };
}

export type InlineState = ReturnType<typeof useInlineState>;

export function chipStyleOf(inline: Pick<InlineState, 'ownStyle' | 'instance'>, snapshot: ElementSnapshot | undefined): InlineStyle {
  const path = inline.instance ? getHost().selectedComponentPath : undefined;
  const text = path === undefined ? undefined : componentSource(path);
  return chipInlineStyle(inline.ownStyle, {
    instance: inline.instance,
    style: snapshot?.attributes['style'],
    component: path === undefined || text === undefined ? undefined : { path, text },
  });
}

export function inlineTargetOf(inline: InlineState, style: InlineStyle): { readonly shown: boolean; readonly active: boolean } {
  const shown = inlineChipShown(style, { writable: inline.writable, pseudo: inline.pseudo }) || startsInline(style, inline);
  const active = shown && inline.nodeId !== undefined && inline.pickedFor === inline.nodeId;
  return { shown, active };
}

function startsInline(style: InlineStyle, inline: Pick<InlineState, 'writable' | 'pseudo'>): boolean {
  return style.kind === 'none' && inline.writable && !inline.pseudo && inlineDefault() === 'inline';
}

export function inlineResolveInput(input: {
  readonly style: InlineStyle;
  readonly active: boolean;
  readonly branchKey: string | undefined;
}): InlineResolveInput | undefined {
  const { style, active } = input;
  switch (style.kind) {
    case 'declarations':
      return { declarations: style.declarations, selected: active };
    case 'branched': {
      const declarations = readInlineStyle(selectedBranch(style, input.branchKey).body) ?? [];
      return { declarations, selected: active };
    }
    case 'none':
    case 'code':
      return undefined;
    default: {
      const exhaustive: never = style;
      return exhaustive;
    }
  }
}

export function useInlineCard(
  card: StyleCardProps,
  inline: InlineState,
  panel: { readonly deselect: () => void; readonly setSaveError: (message: string | undefined) => void },
): StyleCardProps {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { nodeId, setPickedFor, branchKey, setBranchKey } = inline;
  const { deselect, setSaveError } = panel;
  const style = chipStyleOf(inline, card.snapshot);
  const { shown, active } = inlineTargetOf(inline, style);
  const heldRef = useRef<HeldInlineWrite | undefined>(undefined);
  useForgetHeldWrite(heldRef, nodeId);
  useInlineByDefault({ nodeId, shown, deselect, setPickedFor });
  const refuse = (message: string): void => setSaveError(message);

  const writeDeclarations = (properties: readonly string[], declaration: StyleDeclaration): void => {
    const host = getHost();
    if (nodeId === undefined || host.setInlineStyle === undefined) {
      return;
    }
    const hostText = attributeText(findNode(host.nodes, nodeId), 'string');
    const outcome = inlineStyleWrite(inlineEditBase(hostText, nodeId, heldRef.current), properties, declaration);
    if (outcome.tag === 'refused') {
      refuse(translateDescribed(outcome));
      return;
    }
    setSaveError(undefined);
    heldRef.current = { nodeId, base: hostText, next: outcome.next };
    host.setInlineStyle(nodeId, outcome.next === undefined ? undefined : { type: 'string', value: outcome.next });
  };

  const writeBranch = (body: (branch: StyleBranch) => string | undefined): void => {
    if (style.kind !== 'branched' || nodeId === undefined) {
      return;
    }
    const current = currentExpression(style, nodeId, heldRef.current);
    const read = current === undefined ? undefined : readStyleBranches(current);
    if (current === undefined || read?.tag !== 'branches') {
      refuse(translate('styleModel.embed.inline.changedShape'));
      return;
    }
    const branch = read.branches.find((entry) => entry.key === selectedBranch(style, branchKey).key);
    const nextBody = branch === undefined ? undefined : body(branch);
    if (branch === undefined || nextBody === undefined) {
      return;
    }
    const written = writeStyleBranch(current, branch, nextBody);
    if (written.tag === 'refused') {
      refuse(translateDescribed(written));
      return;
    }
    setSaveError(undefined);
    writeExpression(style, nodeId, current, written.expression, heldRef, refuse);
  };
  const writeBranchDeclarations = (properties: readonly string[], declaration: StyleDeclaration): void => {
    writeBranch((branch) => {
      const outcome = inlineStyleWrite(branch.body, properties, declaration);
      if (outcome.tag === 'refused') {
        refuse(translateDescribed(outcome));
        return undefined;
      }
      return outcome.next ?? '';
    });
  };
  const write = style.kind === 'branched' ? writeBranchDeclarations : writeDeclarations;

  const select = (): void => {
    if (nodeId === undefined) {
      return;
    }
    deselect();
    setPickedFor(nodeId);
    if (!card.cssCodeOpen) {
      card.onToggleCssCode();
    }
  };
  const leave = (): void => setPickedFor(undefined);
  const clear = (): void => {
    const host = getHost();
    if (nodeId === undefined || host.setInlineStyle === undefined) {
      return;
    }
    heldRef.current = { nodeId, base: attributeText(findNode(host.nodes, nodeId), 'string'), next: undefined };
    setPickedFor(undefined);
    host.setInlineStyle(nodeId, undefined);
  };
  const chip: InlineChip | undefined = shown
    ? {
        state: style.kind === 'declarations' ? 'editable' : 'code',
        active,
        onSelect: select,
        onDeselect: leave,
        onClear: style.kind === 'declarations' ? clear : undefined,
      }
    : undefined;
  const withChip: StyleCardProps = {
    ...card,
    inline: chip,
    onSelectActive: (selector) => {
      leave();
      card.onSelectActive(selector);
    },
    onDeselect: () => {
      leave();
      card.onDeselect();
    },
    onAddSelector: (selector, placement) => {
      leave();
      card.onAddSelector(selector, placement);
    },
    onSelectSelector: (selector, prop) => {
      if (selector === INLINE_STYLE_SELECTOR) {
        select();
        return;
      }
      leave();
      card.onSelectSelector(selector, prop);
    },
  };
  if (!active) {
    return withChip;
  }
  if (style.kind === 'code') {
    return {
      ...withChip,
      inlineCode: { kind: 'readonly', code: style.code, reason: translateDescribed({ message: style.message, messageRef: style.messageRef }) },
      setProp: ignoreWrite,
      onAdd: ignoreAdd,
      liveSetProp: ignoreLive,
      clearProp: () => Promise.resolve(),
    };
  }
  const setProp: SetProp = (prop, typed, important) => {
    const value = writtenValue(prop, typed);
    write([prop], value.trim() === '' ? { tag: 'remove' } : inlineDeclaration(value, { important }));
    return 'until-model';
  };
  const writes = {
    setProp,
    onAdd: setProp,
    liveSetProp: ignoreLive,
    clearProp: (prop: string | string[]) => {
      write(Array.isArray(prop) ? prop : [prop], { tag: 'remove' });
      return Promise.resolve();
    },
  };
  if (style.kind === 'declarations') {
    const plain: InlineBranchView = {
      branches: [plainStyleBranch(style.text)],
      selected: plainStyleBranch(style.text),
      onSelect: () => undefined,
      onCommit: (body) => {
        const host = getHost();
        if (nodeId === undefined || host.setInlineStyle === undefined) {
          return;
        }
        const outcome = plainStyleCommit(body);
        if (outcome.tag === 'refused') {
          refuse(translateDescribed(outcome));
          return;
        }
        setSaveError(undefined);
        heldRef.current = { nodeId, base: attributeText(findNode(host.nodes, nodeId), 'string'), next: outcome.next };
        host.setInlineStyle(nodeId, outcome.next === undefined ? undefined : { type: 'string', value: outcome.next });
      },
      writesTo: undefined,
    };
    return { ...withChip, ...writes, sourceNote: undefined, inlineCode: { kind: 'branches', view: plain } };
  }
  if (style.kind === 'none') {
    return { ...withChip, ...writes, sourceNote: undefined };
  }
  if (style.kind !== 'branched') {
    return withChip;
  }
  const view: InlineBranchView = {
    branches: style.branches,
    selected: selectedBranch(style, branchKey),
    onSelect: setBranchKey,
    onCommit: (body) => writeBranch(() => body),
    writesTo: style.source.kind === 'component' ? translate('styleModel.embed.inline.writesTo', { file: style.source.fileName }) : undefined,
  };
  return { ...withChip, ...writes, inlineCode: { kind: 'branches', view } };
}

const ignoreWrite: SetProp = () => undefined;
const ignoreAdd = (): void => undefined;
const ignoreLive: LiveSetProp = () => undefined;

function currentExpression(style: Extract<InlineStyle, { kind: 'branched' }>, nodeId: string, held: HeldInlineWrite | undefined): string | undefined {
  const source = style.source;
  switch (source.kind) {
    case 'node': {
      const hostText = attributeText(findNode(getHost().nodes, nodeId), 'expr');
      return inlineEditBase(hostText, nodeId, held);
    }
    case 'component': {
      const text = componentSource(source.path) ?? source.text;
      const span = text.slice(source.start, source.end);
      return span === style.expression || text === source.text ? span : undefined;
    }
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function writeExpression(
  style: Extract<InlineStyle, { kind: 'branched' }>,
  nodeId: string,
  current: string,
  next: string,
  heldRef: { current: HeldInlineWrite | undefined },
  refuse: (message: string) => void,
): void {
  const source = style.source;
  switch (source.kind) {
    case 'node': {
      const host = getHost();
      assert(host.setInlineStyle !== undefined, 'writeExpression: a node expression is shown only where the host writes');
      heldRef.current = { nodeId, base: attributeText(findNode(host.nodes, nodeId), 'expr'), next };
      host.setInlineStyle(nodeId, { type: 'expr', value: next });
      return;
    }
    case 'component': {
      const before = componentSource(source.path) ?? source.text;
      assert(before.slice(source.start, source.end) === current, 'writeExpression: the expression is where the file says');
      const after = componentStyleText({ text: before, start: source.start, end: source.end }, next);
      void writeComponentStyle(source.path, source.fileName, { before, after }).catch((error: unknown) => refuse(String(error)));
      return;
    }
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function attributeText(node: HostNode | undefined, type: 'string' | 'expr'): string | undefined {
  const attribute = node?.props?.['style'];
  if (attribute?.type !== type) {
    return undefined;
  }
  return attribute.value;
}

function useForgetHeldWrite(heldRef: { current: HeldInlineWrite | undefined }, nodeId: string | undefined): void {
  useEffect(() => {
    if (heldRef.current !== undefined && heldRef.current.nodeId !== nodeId) {
      heldRef.current = undefined;
    }
  }, [heldRef, nodeId]);
  useEffect(() => {
    const forgetTaken = (): void => {
      const held = heldRef.current;
      if (held === undefined) {
        return;
      }
      const node = findNode(getHost().nodes, held.nodeId);
      heldRef.current = heldUntilTaken(held, [attributeText(node, 'string'), attributeText(node, 'expr')]);
      assert(heldRef.current === undefined || heldRef.current === held, 'useForgetHeldWrite: a hold is kept or dropped, never changed');
    };
    return onHostChange(forgetTaken);
  }, [heldRef]);
}

function useSelectedHostNode(): HostNode | undefined {
  const [, bump] = useState(0);
  useEffect(() => onHostChange(() => bump((count) => count + 1)), []);
  return readSelectedNode();
}

function readSelectedNode(): HostNode | undefined {
  const host = getHost();
  return host.selectedId === undefined ? undefined : findNode(host.nodes, host.selectedId);
}

function useInlineByDefault(input: {
  readonly nodeId: string | undefined;
  readonly shown: boolean;
  readonly deselect: () => void;
  readonly setPickedFor: (nodeId: string | undefined) => void;
}): void {
  const latest = useRef(input);
  latest.current = input;
  const applied = useRef<string | undefined>(undefined);
  const { nodeId, shown } = input;
  useEffect(() => {
    if (nodeId === undefined || !shown || applied.current === nodeId || inlineDefault() !== 'inline') {
      return;
    }
    applied.current = nodeId;
    const { deselect, setPickedFor } = latest.current;
    deselect();
    setPickedFor(nodeId);
  }, [nodeId, shown]);
}
