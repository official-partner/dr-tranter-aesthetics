
import { assert } from '../../../../shared/core/assert';
import { HOVER_STYLE_LIMITS, HOVER_STYLE_MESSAGE, parseHoverStyleMessage, type HoverDeclaration } from '../../../../shared/properties/liveRules';
import type { PreviewProp } from '../connectFieldHelpers';
import { writtenValue } from '../model/lengthUnit';
import { getHost } from '../model/host';
import { hoverStyle } from '../model/liveRuleEdits';
import { parseImportant } from '../model/styleDisplay';
import { isSupportedCssValue } from '../model/supportedCssValue';

export interface CanvasPreviewContext {
  readonly stateKey: string;
  readonly activeSelector: string | undefined;
}

export const SELECTED_ELEMENT_PREVIEW: CanvasPreviewContext = { stateKey: '', activeSelector: undefined };

export function canvasPreviewProp({ stateKey, activeSelector }: CanvasPreviewContext): PreviewProp {
  return (propOrProps, typed, important) => {
    const props: readonly string[] = typeof propOrProps === 'string' ? [propOrProps] : propOrProps;
    assert(props.length > 0, 'Canvas preview: a preview names a property');
    const shown = typed === undefined ? undefined : hoverDeclarationsOf(props, typed, { important, stateKey, activeSelector });
    if (shown === undefined) {
      hoverStyle.clear(props);
      return;
    }
    hoverStyle.show(shown.path, shown.declarations);
    assert(hoverStyle.showing().length === shown.declarations.length, 'Canvas preview: the shown properties are remembered');
  };
}

function hoverDeclarationsOf(
  props: readonly string[],
  typed: string,
  { important, stateKey, activeSelector }: { readonly important: boolean; readonly stateKey: string; readonly activeSelector: string | undefined },
): { readonly path: string; readonly declarations: readonly HoverDeclaration[] } | undefined {
  if (stateKey.length > 0) {
    return undefined;
  }
  if (activeSelector !== undefined) {
    if (activeSelector.includes('::')) {
      return undefined;
    }
  }
  const host = getHost();
  const nodeId = host.selectedId;
  if (nodeId === undefined) {
    return undefined;
  }
  const path = host.pathOf?.(nodeId);
  if (path === undefined) {
    return undefined;
  }
  const parsed = parseImportant(typed.trim());
  const declarations: HoverDeclaration[] = [];
  for (const prop of props.slice(0, HOVER_STYLE_LIMITS.declarationsMax)) {
    const value = writtenValue(prop, parsed.value);
    if (value.length === 0) {
      return undefined;
    }
    if (!isSupportedCssValue(prop, value)) {
      return undefined;
    }
    declarations.push({ property: prop, value, important: important || parsed.important });
  }
  const message = parseHoverStyleMessage({ type: HOVER_STYLE_MESSAGE, op: 'show', path, declarations });
  return message?.op === 'show' ? { path: message.path, declarations: message.declarations } : undefined;
}
