import { ErrorToast } from '../../ui/ErrorToast';
import { requestSelectorFocus } from './embed/SelectorPicker';
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStyleFiles } from './useStyleFiles';
import type { ClassOutcome, HostState, StyleBlockRequest } from './model/host';
import type { ClassPlacement } from '../../editor/classAttr';
import { styleableSelection } from './model/styleTarget';
import { setHost } from './model/host';
import { prefetchComponentSources } from './model/componentSourceCache';
import { computedStylesSettled, prefetchComputedStyles } from './model/computedStyle';
import { assert } from '../../../shared/core/assert';
import { PX_LENGTHS, sameLengthUnit, type LengthUnit } from '../../../shared/properties/lengthUnit';
import EmbedEditor from './EmbedEditor';
import { useTranslate } from '../../lib/i18n/useTranslate';
import './tokens.css';
import './utilities.css';
import './embedEditor.css';
import { readAstroStyleFiles, readStyleFiles } from './stylePanelBridge';
import { clickNote } from '../../ui/sound';
import { SoundHere } from '../../ui/soundScope';
import usePopupOpen from './usePopupOpen';

interface StylePanelProps {
  readonly project: { readonly path: string } | undefined;
  readonly model?: { readonly nodes: HostState['nodes'] } | undefined;
  readonly node?: { readonly id: string } | undefined;
  readonly device?: string;
  readonly canvasWidthPx?: number | undefined;
  readonly pathOf?: HostState['pathOf'];
  readonly onWriteStyleNode?: HostState['writeStyleNode'] | undefined;
  readonly onSelectNode?: HostState['selectNode'] | undefined;
  readonly onCanvasWidth?: HostState['setCanvasWidth'] | undefined;
  readonly onDesktopCanvas?: HostState['showDesktopCanvas'] | undefined;
  readonly onRecordUndo?: HostState['recordUndo'] | undefined;
  readonly onOpenStyleTagSettings?: HostState['openStyleTagSettings'];
  readonly onAddClass?: ((className: string, placement: ClassPlacement, nodeId: string) => Promise<ClassOutcome>) | undefined;
  readonly onAddStyleBlock?: ((request: StyleBlockRequest, nodeId: string) => Promise<ClassOutcome>) | undefined;
  readonly onRemoveClass?: ((className: string, nodeId: string) => Promise<ClassOutcome>) | undefined;
  readonly onRemoveAttribute?: ((attributeName: string, nodeId: string) => Promise<ClassOutcome>) | undefined;
  readonly onSetInlineStyle?: HostState['setInlineStyle'] | undefined;
  readonly pageComponentPaths?: readonly string[] | undefined;
  readonly renderedClassesKnown?: boolean | undefined;
  readonly onSpacingHover?: HostState['onSpacingHover'];
  readonly renderedClasses?: readonly string[] | undefined;
  readonly projectClasses?: readonly string[] | undefined;
  readonly historyTick?: number;
  readonly openFilePath?: string | undefined;
  readonly openFileKind?: HostState['openFileKind'];
  readonly contextPagePath?: string | undefined;
  readonly selectedComponentPath?: string | undefined;
  readonly pseudoRequest?: HostState['pseudoRequest'];
  readonly pseudoRows?: boolean;
  readonly selectorFocus?: number;
  readonly lengthUnit?: LengthUnit | undefined;
}

type StyleFiles = HostState['files'];

const NO_PATHS: readonly string[] = [];

export default function StylePanel(rawProps: StylePanelProps) {
  const props = withStyleableNode(rawProps);
  const files = useStyleFiles(props.project?.path, undefined, readStyleFiles);
  const translate = useTranslate();
  const pageComponentPaths = props.pageComponentPaths ?? NO_PATHS;
  const astroFilesKey = [props.openFilePath ?? '', ...pageComponentPaths].join('\u0000');
  const astroFiles = useStyleFiles(props.project?.path, astroFilesKey, readAstroStyleFiles);
  const lengthUnit = useStableLengthUnit(props.lengthUnit ?? PX_LENGTHS);
  const renderedClasses = useStableList(props.renderedClasses ?? NO_PATHS);
  const projectClasses = useStableList(props.projectClasses ?? NO_PATHS);
  const selection = useSelectionShown(props, renderedClasses);
  const writes = useShownElementWrites(props, selection);
  const host = hostState(
    { ...props, ...selection.props },
    { files: files.files, astroFiles: astroFiles.files, lengthUnit, renderedClasses: selection.renderedClasses, projectClasses, writes },
  );
  setHost(host);
  useEffect(() => setHost(host), [host]);
  useEffect(() => prefetchComponentSources(pageComponentPaths), [pageComponentPaths]);
  const hostRef = useRef<HTMLDivElement>(null);
  useSwitchScrollAnchor(hostRef, selection.props.node?.id);
  usePanelBounds(hostRef);
  useSelectorFocus(hostRef, props.selectorFocus ?? 0);
  const popupOpen = usePopupOpen(hostRef);
  if (!props.project) {
    return undefined;
  }
  return (
    <SoundHere>
      <div className={`style-panel-host ${popupOpen ? 'is-locked' : ''}`} ref={hostRef} onClick={playButtonNote}>
        {files.error || astroFiles.error ? (
          <ErrorToast message={translate('style.stylePanel.loadError', { error: files.error || astroFiles.error || '' })} />
        ) : undefined}
        {selection.props.node ? <EmbedEditor /> : <div className="props-empty">{translate('style.stylePanel.selectElement')}</div>}
      </div>
    </SoundHere>
  );
}

function withStyleableNode(props: StylePanelProps): StylePanelProps {
  const node = styleableSelection(props.model, props.node);
  return node === props.node ? props : { ...props, node: undefined };
}

type SelectionProps = Pick<StylePanelProps, 'node' | 'renderedClassesKnown' | 'selectedComponentPath' | 'pseudoRequest'>;
interface ShownSelection {
  readonly props: SelectionProps;
  readonly renderedClasses: string[];
}

function selectionOf(props: StylePanelProps, renderedClasses: string[]): ShownSelection {
  return {
    props: {
      node: props.node,
      renderedClassesKnown: props.renderedClassesKnown,
      selectedComponentPath: props.selectedComponentPath,
      pseudoRequest: props.pseudoRequest,
    },
    renderedClasses,
  };
}

type ElementWrites = Pick<HostState, 'addClass' | 'addStyleBlock' | 'removeClass' | 'removeAttribute' | 'setInlineStyle'>;

function useShownElementWrites(props: StylePanelProps, selection: ShownSelection): ElementWrites {
  const translate = useTranslate();
  const shownId = selection.props.node?.id;
  const { onAddClass, onAddStyleBlock, onRemoveClass, onRemoveAttribute, onSetInlineStyle } = props;
  return useMemo(() => {
    const guarded = (write: (nodeId: string) => Promise<ClassOutcome>): Promise<ClassOutcome> => {
      if (shownId === undefined) {
        return Promise.resolve({ tag: 'refused', message: translate('shell.refusal.noElement') });
      }
      return write(shownId);
    };
    return {
      addClass: onAddClass === undefined ? undefined : (className, placement) => guarded((nodeId) => onAddClass(className, placement, nodeId)),
      addStyleBlock: onAddStyleBlock === undefined ? undefined : (request) => guarded((nodeId) => onAddStyleBlock(request, nodeId)),
      removeClass: onRemoveClass === undefined ? undefined : (className) => guarded((nodeId) => onRemoveClass(className, nodeId)),
      removeAttribute: onRemoveAttribute === undefined ? undefined : (attributeName) => guarded((nodeId) => onRemoveAttribute(attributeName, nodeId)),
      setInlineStyle: onSetInlineStyle,
    };
  }, [onAddClass, onAddStyleBlock, onRemoveClass, onRemoveAttribute, onSetInlineStyle, shownId, translate]);
}

function selectionKeyOf(props: StylePanelProps): string {
  return `${props.openFilePath ?? ''}\u0000${props.node?.id ?? ''}`;
}

function useSelectionShown(props: StylePanelProps, renderedClasses: string[]): ShownSelection {
  const key = selectionKeyOf(props);
  const shownKeyRef = useRef(key);
  const targetId = props.node?.id;
  useLayoutEffect(() => {
    const previousKey = shownKeyRef.current;
    shownKeyRef.current = key;
    if (previousKey === key || targetId === undefined) {
      return;
    }
    if (!computedStylesSettled(targetId)) {
      void prefetchComputedStyles(targetId);
    }
  }, [key, targetId]);
  return selectionOf(props, renderedClasses);
}

interface ScrollAnchor {
  readonly key: string;
  readonly content: string;
  readonly offsetPx: number;
}

const SCROLL_ANCHOR_CANDIDATES_MAX = 64;
const SCROLL_ANCHOR_ROWS_MAX = 4096;
const SCROLL_ANCHOR_SELECTOR = '[data-prop], .embed-editor_section-title, button.u-select-button[aria-label], [role="group"][aria-label]';
const SCROLL_RESERVE_PROPERTY = '--switch-scroll-reserve';
const SCROLL_MOVE_PX_TOLERANCE = 0.5;

function panelScroller(host: HTMLElement | undefined): HTMLElement | undefined {
  const root = host?.querySelector(':scope > .embed-editor_root');
  return root instanceof HTMLElement ? root : undefined;
}

function anchorKeyOf(element: Element): string {
  const prop = element.getAttribute('data-prop');
  if (prop !== null) {
    return `prop:${prop}`;
  }
  const label = element.getAttribute('aria-label');
  return label === null ? `section:${(element.textContent ?? '').trim()}` : `label:${label}`;
}

function anchorContentOf(element: Element): string {
  const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : '';
  const row = element.closest('.embed-editor_varconnect') ?? element;
  return `${value}|${(row.textContent ?? '').trim()}`;
}

function visibleAnchors(scroller: HTMLElement): ScrollAnchor[] {
  const topPx = scroller.getBoundingClientRect().top;
  const anchors: ScrollAnchor[] = [];
  const seen = new Set<string>();
  const elements = scroller.querySelectorAll(SCROLL_ANCHOR_SELECTOR);
  assert(elements.length <= SCROLL_ANCHOR_ROWS_MAX, 'visibleAnchors: the panel has a bounded number of rows');
  for (const element of elements) {
    if (anchors.length >= SCROLL_ANCHOR_CANDIDATES_MAX) {
      break;
    }
    const key = anchorKeyOf(element);
    const offsetPx = element.getBoundingClientRect().top - topPx;
    if (offsetPx >= 0 && !seen.has(key)) {
      seen.add(key);
      anchors.push({ key, content: anchorContentOf(element), offsetPx });
    }
  }
  return anchors;
}

function anchorsByKey(scroller: HTMLElement, keys: ReadonlySet<string>): ScrollAnchor[] {
  const topPx = scroller.getBoundingClientRect().top;
  const anchors: ScrollAnchor[] = [];
  const seen = new Set<string>();
  const elements = scroller.querySelectorAll(SCROLL_ANCHOR_SELECTOR);
  assert(elements.length <= SCROLL_ANCHOR_ROWS_MAX, 'anchorsByKey: the panel has a bounded number of rows');
  for (const element of elements) {
    const key = anchorKeyOf(element);
    if (keys.has(key) && !seen.has(key)) {
      seen.add(key);
      anchors.push({ key, content: anchorContentOf(element), offsetPx: element.getBoundingClientRect().top - topPx });
    }
  }
  return anchors;
}

function anchorMovePx(before: readonly ScrollAnchor[], after: readonly ScrollAnchor[]): number | undefined {
  const afterByKey = new Map(after.map((anchor) => [anchor.key, anchor]));
  let firstSurvivingPx: number | undefined;
  const moves: number[] = [];
  for (const anchor of before) {
    const now = afterByKey.get(anchor.key);
    if (now === undefined) {
      continue;
    }
    const movedPx = now.offsetPx - anchor.offsetPx;
    firstSurvivingPx ??= movedPx;
    if (now.content === anchor.content) {
      moves.push(movedPx);
    }
  }
  let bestPx = firstSurvivingPx;
  let bestCount = 0;
  for (const candidatePx of moves) {
    const count = moves.filter((movedPx) => Math.abs(movedPx - candidatePx) <= SCROLL_MOVE_PX_TOLERANCE).length;
    if (count > bestCount) {
      bestCount = count;
      bestPx = candidatePx;
    }
  }
  assert(bestCount <= moves.length, 'anchorMovePx: a move is counted among the moves');
  return bestPx;
}

function useSwitchScrollAnchor(hostRef: React.RefObject<HTMLDivElement>, shownId: string | undefined): void {
  const anchoredIdRef = useRef(shownId);
  const pendingRef = useRef<readonly ScrollAnchor[] | undefined>(undefined);
  if (shownId !== anchoredIdRef.current) {
    const scroller = panelScroller(hostRef.current ?? undefined);
    const switching = anchoredIdRef.current !== undefined && shownId !== undefined;
    pendingRef.current = scroller !== undefined && switching && scroller.scrollTop > 0 ? visibleAnchors(scroller) : undefined;
    anchoredIdRef.current = shownId;
  }
  useLayoutEffect(() => {
    const anchors = pendingRef.current;
    pendingRef.current = undefined;
    const scroller = panelScroller(hostRef.current ?? undefined);
    if (anchors === undefined || scroller === undefined) {
      return undefined;
    }
    restoreScrollAnchor(scroller, anchors);
    return holdScrollAnchor(scroller);
  }, [hostRef, shownId]);
}

const SCROLL_ANCHOR_HOLD_MS = 2000;
const POPUP_ROLES = '[role="menu"],[role="dialog"],[role="listbox"]';
const SCROLL_ANCHOR_RELEASE_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;

function holdScrollAnchor(scroller: HTMLElement): () => void {
  let anchors = visibleAnchors(scroller);
  scroller.style.setProperty('overflow-anchor', 'none');
  const observer = new ResizeObserver(() => {
    if (document.querySelector(POPUP_ROLES) === null) {
      restoreScrollAnchor(scroller, anchors);
    }
    anchors = visibleAnchors(scroller);
  });
  for (const child of scroller.children) {
    observer.observe(child);
  }
  const release = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    scroller.style.removeProperty('overflow-anchor');
    for (const type of SCROLL_ANCHOR_RELEASE_EVENTS) {
      scroller.removeEventListener(type, release, true);
    }
  };
  const timer = window.setTimeout(release, SCROLL_ANCHOR_HOLD_MS);
  for (const type of SCROLL_ANCHOR_RELEASE_EVENTS) {
    scroller.addEventListener(type, release, { capture: true, passive: true });
  }
  return release;
}

function restoreScrollAnchor(scroller: HTMLElement, anchors: readonly ScrollAnchor[]): void {
  const movedPx = anchorMovePx(anchors, anchorsByKey(scroller, new Set(anchors.map((anchor) => anchor.key))));
  if (movedPx === undefined) {
    return;
  }
  if (Math.abs(movedPx) <= SCROLL_MOVE_PX_TOLERANCE) {
    return;
  }
  const targetPx = scroller.scrollTop + movedPx;
  scroller.style.setProperty(SCROLL_RESERVE_PROPERTY, '0px');
  const scrollMaxPx = scroller.scrollHeight - scroller.clientHeight;
  const reservePx = Math.max(0, Math.ceil(targetPx - scrollMaxPx));
  scroller.style.setProperty(SCROLL_RESERVE_PROPERTY, `${reservePx}px`);
  scroller.scrollTo({ top: targetPx, behavior: 'instant' });
}

function useStableLengthUnit(next: LengthUnit): LengthUnit {
  const held = useRef(next);
  if (!sameLengthUnit(held.current, next)) {
    held.current = next;
  }
  return held.current;
}

function useStableList(next: readonly string[]): string[] {
  const held = useRef<string[]>([...next]);
  const same = held.current.length === next.length && held.current.every((item, index) => item === next[index]);
  if (!same) {
    held.current = [...next];
  }
  return held.current;
}

const NO_NODES: HostState['nodes'] = [];

interface HostInputs {
  readonly files: StyleFiles;
  readonly astroFiles: StyleFiles;
  readonly lengthUnit: LengthUnit;
  readonly renderedClasses: string[];
  readonly projectClasses: string[];
  readonly writes: ElementWrites;
}

function hostState(props: StylePanelProps, inputs: HostInputs): HostState {
  const { files, astroFiles, lengthUnit } = inputs;
  return {
    projectPath: props.project?.path,
    nodes: props.model?.nodes ?? NO_NODES,
    selectedId: props.node?.id,
    pathOf: props.pathOf,
    device: props.device ?? 'desktop',
    canvasWidthPx: props.canvasWidthPx,
    files,
    astroFiles,
    openFilePath: props.openFilePath,
    openFileKind: props.openFileKind,
    contextPagePath: props.contextPagePath,
    selectedComponentPath: props.selectedComponentPath,
    writeStyleNode: props.onWriteStyleNode,
    selectNode: props.onSelectNode,
    setCanvasWidth: props.onCanvasWidth,
    showDesktopCanvas: props.onDesktopCanvas,
    recordUndo: props.onRecordUndo,
    openStyleTagSettings: props.onOpenStyleTagSettings,
    ...inputs.writes,
    pageComponentPaths: props.pageComponentPaths ?? NO_PATHS,
    renderedClassesKnown: props.renderedClassesKnown ?? true,
    onSpacingHover: props.onSpacingHover,
    renderedClasses: inputs.renderedClasses,
    projectClasses: inputs.projectClasses,
    historyTick: props.historyTick ?? 0,
    pseudoRequest: props.pseudoRequest,
    pseudoRows: props.pseudoRows === true,
    lengthUnit,
  };
}

let selectorFocusHandled = 0;
const SELECTOR_FOCUS_FRAMES_MAX = 30;

function useSelectorFocus(hostRef: React.RefObject<HTMLDivElement>, tick: number): void {
  useEffect(() => {
    if (tick <= selectorFocusHandled) {
      return undefined;
    }
    selectorFocusHandled = tick;
    let frames = 0;
    let request = 0;
    const tryFocus = (): void => {
      if (requestSelectorFocus()) {
        return;
      }
      frames += 1;
      if (frames < SELECTOR_FOCUS_FRAMES_MAX) {
        request = requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
    return () => cancelAnimationFrame(request);
  }, [hostRef, tick]);
}

function usePanelBounds(hostRef: React.RefObject<HTMLDivElement>): void {
  useEffect(() => {
    const element = hostRef.current;
    if (!element) {
      return;
    }
    const withdraw = (): void => {
      for (const name of PANEL_BOUNDS_PROPERTIES) {
        document.documentElement.style.removeProperty(name);
      }
    };
    const publish = (): void => {
      const bounds = element.getBoundingClientRect();
      const style = document.documentElement.style;
      if (bounds.width <= 0 || bounds.height <= 0) {
        withdraw();
        return;
      }
      style.setProperty('--style-panel-left', `${bounds.left}px`);
      style.setProperty('--style-panel-top', `${bounds.top}px`);
      style.setProperty('--style-panel-width', `${bounds.width}px`);
      style.setProperty('--style-panel-height', `${bounds.height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      withdraw();
    };
  }, [hostRef]);
}

const PANEL_BOUNDS_PROPERTIES = ['--style-panel-left', '--style-panel-top', '--style-panel-width', '--style-panel-height'] as const;

function playButtonNote(event: React.MouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest('button');
  if (button && !button.disabled) {
    clickNote();
  }
}
