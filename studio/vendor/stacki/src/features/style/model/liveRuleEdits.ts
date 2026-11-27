
import { assert } from '../../../../shared/core/assert';
import {
  HOVER_STYLE_LIMITS,
  HOVER_STYLE_MESSAGE,
  LIVE_RULE_LIMITS,
  LIVE_RULE_MESSAGE,
  liveRuleKey,
  parseLiveRuleTarget,
  type HoverDeclaration,
  type HoverStyleMessage,
  type LiveRuleEdit,
  type LiveRuleMessage,
  type LiveRuleTarget,
} from '../../../../shared/properties/liveRules';
import { tellCanvas } from '../../../editor/canvasQuery';
import type { ParsedRule } from './styleTypes';
import type { EmbedSource } from './webflow';

export interface LiveRulePreview {
  readonly target: LiveRuleTarget;
  readonly token: number;
}

export function createLiveRules(post: (message: LiveRuleMessage) => void) {
  const newest = new Map<string, number>();
  let tokenNext = 1;

  const remember = (key: string, token: number): void => {
    newest.delete(key);
    if (newest.size >= LIVE_RULE_LIMITS.entriesMax) {
      const oldest = newest.keys().next().value;
      assert(oldest !== undefined, 'Live rules: a full map has an oldest entry');
      newest.delete(oldest);
    }
    newest.set(key, token);
    assert(newest.size <= LIVE_RULE_LIMITS.entriesMax, 'Live rules: tracked edits stay bounded');
  };

  const takeNewest = (preview: LiveRulePreview): boolean => {
    const key = liveRuleKey(preview.target);
    if (newest.get(key) !== preview.token) {
      return false;
    }
    newest.delete(key);
    return true;
  };

  return {
    show(target: LiveRuleTarget, edit: LiveRuleEdit): LiveRulePreview {
      assert(Number.isSafeInteger(tokenNext), 'Live rules: token stays a safe integer');
      const token = tokenNext;
      tokenNext += 1;
      remember(liveRuleKey(target), token);
      post({ type: LIVE_RULE_MESSAGE, op: 'set', rule: target, edit });
      return { target, token };
    },
    landed(preview: LiveRulePreview, edit: LiveRuleEdit): void {
      if (takeNewest(preview)) {
        post({ type: LIVE_RULE_MESSAGE, op: 'drop', rule: preview.target, until: edit });
      }
    },
    failed(preview: LiveRulePreview): void {
      if (takeNewest(preview)) {
        post({ type: LIVE_RULE_MESSAGE, op: 'drop', rule: preview.target });
      }
    },
  };
}

export const liveRules = createLiveRules((message) => {
  tellCanvas(message);
});

export function liveRuleTargetOf(rule: ParsedRule, source: EmbedSource, property: string, projectPath: string | undefined): LiveRuleTarget | undefined {
  if (rule.written !== undefined && rule.written.parents.length > 0) {
    return undefined;
  }
  const path = sourcePathOf(source);
  if (path === undefined) {
    return undefined;
  }
  const relative = projectRelative(path, projectPath);
  if (relative === undefined) {
    return undefined;
  }
  return parseLiveRuleTarget({ source: relative, context: rule.atContext, selector: rule.selectorText, property });
}

function sourcePathOf(source: EmbedSource): string | undefined {
  const origin = source.origin;
  switch (origin.kind) {
    case 'file':
    case 'astro':
      return origin.path;
    case 'node':
      return origin.filePath;
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

export function projectRelative(path: string, projectPath: string | undefined): string | undefined {
  let relative = path.replace(/\\/g, '/');
  if (projectPath !== undefined) {
    const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (root.length > 0) {
      if (relative.startsWith(`${root}/`)) {
        relative = relative.slice(root.length + 1);
      }
    }
  }
  relative = relative.replace(/^(?:\.\/|\/)+/, '');
  if (relative.length === 0) {
    return undefined;
  }
  if (relative.split('/').includes('..')) {
    return undefined;
  }
  return relative;
}


export function createHoverStyle(post: (message: HoverStyleMessage) => void) {
  let shown: readonly HoverDeclaration[] | undefined = undefined;
  const owns = (properties: readonly string[]): boolean =>
    shown !== undefined && properties.some((property) => shown?.some((declaration) => declaration.property === property) === true);
  const clear = (properties: readonly string[]): void => {
    if (!owns(properties)) {
      return;
    }
    shown = undefined;
    post({ type: HOVER_STYLE_MESSAGE, op: 'clear' });
  };
  return {
    show(path: string, declarations: readonly HoverDeclaration[]): void {
      assert(declarations.length > 0, 'Hover style: a preview shows something');
      assert(declarations.length <= HOVER_STYLE_LIMITS.declarationsMax, 'Hover style: declarations stay bounded');
      shown = declarations;
      post({ type: HOVER_STYLE_MESSAGE, op: 'show', path, declarations });
    },
    clear,
    settle(property: string, value: string): void {
      if (!owns([property])) {
        return;
      }
      const previewed = shown?.find((declaration) => declaration.property === property);
      if (previewed === undefined || previewed.value !== value) {
        clear([property]);
        return;
      }
      shown = undefined;
      post({ type: HOVER_STYLE_MESSAGE, op: 'settle' });
    },
    showing(): readonly string[] {
      return shown === undefined ? [] : shown.map((declaration) => declaration.property);
    },
  };
}

export const hoverStyle = createHoverStyle((message) => {
  tellCanvas(message);
});
