
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { StyleHandle, StyleTargetOptions, WebflowApi } from './webflowDesigner';
import { type ClipShape, type ShapeScaleOptions, type ClipPathStyleOrigin, type SelectionReadOptions, type PastedShapeSvgCache } from './clipPathTypes';
import { DEFAULT_SHAPE_OFFSET_LEFT_VARIABLE_NAME, DEFAULT_SHAPE_OFFSET_TOP_VARIABLE_NAME, CLIP_PATH_DEBUG, NONE_SHAPE } from './clipPathConstants';
import { shapesClose } from './clipPathHandles';
import { shapeOffsetVariableNamesFromValue, shapeScaleVariableNameFromValue } from './shapeFunctionPatterns';
import { cacheFromShapeFitVariants, normalizeShapeFitCache } from './shapeFunctionModel';
import { normalizeClipPathValue } from './svgContours';
import { matchPreset } from './clipPathShortcuts';
import { isSpaceKey, isRadiusUnlockKey, isArrowKey } from './shapeKeyboard';
import {
  debugClipPath,
  selectedElementKey,
  getElementPrimaryStyleHandles,
  getElementClassNames,
  getStyleLookupCandidates,
  getStyleNamePath,
  getClassStyleHandlesWithDiagnostics,
} from './clipPathStyleRead';
import {
  hasClipPathDeclaration,
  styleOptionsForBreakpoint,
  clipPathStyleOriginFromSource,
  readClipPathDeclarationWithSource,
  readPastedShapeMetadata,
  findClipPathStyle,
  debugStyleSummary,
  debugStyleSummaries,
  findStyleForClassPath,
  resolveCascadeWinnerClipPathStyle,
} from './clipPathStyleWrite';
import { type EditorAfterShortcutListeners, windowKeyDownActions } from './clipPathPointerActions';

export type EditorAfterWindowKeyDownActions = EditorAfterShortcutListeners & ReturnType<typeof windowKeyDownActions>;

export function useWindowKeyListeners(editor: EditorAfterWindowKeyDownActions) {
  const { handledKeyboardEventsRef, radiusUnlockKeyPressedRef } = editor;
  const { updateKeyboardModifierRefs, spaceKeyPressedRef, selectedHandleRef } = editor;
  const { isShapeTransformSelectedRef, releaseKeyboardMoveKey, keyboardModifiersRef } = editor;
  const { stopKeyboardMoveLoop, setActiveInsetModifierMode, onWindowKeyDown } = editor;
  const onWindowKeyUp = (event: KeyboardEvent) => {
    if (handledKeyboardEventsRef.current.has(event)) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    const isHandleTarget = target instanceof Element && Boolean(target.closest('.clip-path_handle'));

    if (isRadiusUnlockKey(event.key, event.code)) {
      radiusUnlockKeyPressedRef.current = false;
      updateKeyboardModifierRefs({
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        radiusUnlocked: false,
      });
      return;
    }

    if (isHandleTarget && (isSpaceKey(event.key, event.code) || isArrowKey(event.key))) {
      return;
    }

    if (isSpaceKey(event.key, event.code)) {
      spaceKeyPressedRef.current = false;
      if (selectedHandleRef.current || isShapeTransformSelectedRef.current) {
        event.preventDefault();
      }
      return;
    }

    updateKeyboardModifierRefs(event);
    if (!isArrowKey(event.key)) {
      return;
    }

    releaseKeyboardMoveKey(event.key, event);
  };

  const onWindowKeyBlur = () => {
    spaceKeyPressedRef.current = false;
    radiusUnlockKeyPressedRef.current = false;
    keyboardModifiersRef.current = { altKey: false, shiftKey: false, radiusUnlocked: false };
    stopKeyboardMoveLoop();
    setActiveInsetModifierMode('single');
  };

  const windowKeyHandlers = { onWindowKeyDown, onWindowKeyUp, onWindowKeyBlur };
  const windowKeyRef = useRef(windowKeyHandlers);
  windowKeyRef.current = windowKeyHandlers;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => windowKeyRef.current.onWindowKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => windowKeyRef.current.onWindowKeyUp(event);
    const onBlur = () => windowKeyRef.current.onWindowKeyBlur();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return { onWindowKeyUp, onWindowKeyBlur, windowKeyHandlers, windowKeyRef };
}

export type EditorAfterWindowKeyListeners = EditorAfterWindowKeyDownActions & ReturnType<typeof useWindowKeyListeners>;

export type SelectionReader = EditorAfterWindowKeyListeners;

export type SelectionSession = {
  cancelled: boolean;
  readonly webflowApi: WebflowApi;
  readonly readerRef: MutableRefObject<SelectionReader>;
};

export type SelectionRead = { readSeq: number; force: boolean; debugRead: boolean };

export type FoundClipPathStyle = Awaited<ReturnType<typeof findClipPathStyle>>;
export type ElementStyles = {
  styles: StyleHandle[];
  classNames: string[];
  selectedStyle: FoundClipPathStyle;
  styleOptions: StyleTargetOptions | undefined;
};

export function isCurrentRead(session: SelectionSession, read: SelectionRead): boolean {
  if (session.cancelled) {
    return false;
  }
  return read.readSeq === session.readerRef.current.selectionReadSeqRef.current;
}

export function loadNoneIfChanged(reader: SelectionReader, { force }: { force: boolean }): void {
  const { styleRef } = reader;
  styleRef.current = undefined;
  showNoClipPathSource(reader);
  if (reader.onApplyRef.current !== undefined) {
    return;
  }
  if (shouldReloadNone(reader, { force })) {
    reader.loadShapeFromSelection(NONE_SHAPE, 'none');
  }
}

export function loadNoneForWritableStyle(reader: SelectionReader, style: StyleHandle | undefined, { force }: { force: boolean }): void {
  const { styleRef } = reader;
  styleRef.current = style || undefined;
  showNoClipPathSource(reader);
  if (reader.onApplyRef.current !== undefined) {
    return;
  }
  if (shouldReloadNone(reader, { force })) {
    reader.loadShapeFromSelection(NONE_SHAPE, 'none');
  }
}

export function showNoClipPathSource(reader: SelectionReader): void {
  reader.setClipPathStyleOrigin('none');
  reader.setAppliedClassName(undefined);
  reader.setClipPathSourceSelector([]);
  reader.setClipPathSourceBreakpoint(undefined);
  reader.setIsClipPathLabelMenuOpen(false);
}

export function shouldReloadNone(reader: SelectionReader, { force }: { force: boolean }): boolean {
  return force || reader.lastWrittenRef.current !== 'none' || !shapesClose(reader.shapeRef.current, NONE_SHAPE);
}

export async function readSelectedElement(session: SelectionSession, element: unknown, options: SelectionReadOptions = {}): Promise<void> {
  const read = startSelectionRead(session, element, options);
  if (!read) {
    return;
  }
  try {
    await readElementClipPath(session, read, element);
  } catch (error: unknown) {
    if (read.debugRead) {
      debugClipPath('readSelectedElement:error', error);
    }
    if (isCurrentRead(session, read)) {
      if (read.force) {
        loadNoneIfChanged(session.readerRef.current, { force: read.force });
      }
    }
  } finally {
    const reader = session.readerRef.current;
    if (read.readSeq === reader.selectionReadSeqRef.current) {
      reader.selectionReadInProgressRef.current = false;
    }
  }
}

export function startSelectionRead(session: SelectionSession, element: unknown, options: SelectionReadOptions): SelectionRead | undefined {
  const reader = session.readerRef.current;
  const force = options.force ?? false;
  if (reader.selectionReadInProgressRef.current && !force && !options.resetStyle) {
    return undefined;
  }
  reader.selectionReadInProgressRef.current = true;
  const readSeq = ++reader.selectionReadSeqRef.current;
  const nextElementKey = selectedElementKey(element);
  const selectionChanged = nextElementKey !== reader.selectedElementKeyRef.current;
  const debugRead = Boolean(CLIP_PATH_DEBUG && (force || options.resetStyle || selectionChanged));
  if (debugRead) {
    debugClipPath('readSelectedElement:start', {
      activeBreakpoint: reader.activeBreakpointRef.current,
      elementKey: nextElementKey,
      force,
      resetStyle: Boolean(options.resetStyle),
      selectionChanged,
    });
  }
  if (selectionChanged) {
    forgetPreviousElement(reader, nextElementKey);
  }
  if (options.resetStyle) {
    reader.clearPendingWrite();
    reader.localWritePendingRef.current = false;
    reader.styleRef.current = undefined;
  } else if (!selectionChanged && writeInFlight(reader)) {
    reader.selectionReadInProgressRef.current = false;
    return undefined;
  }
  const read = { readSeq, force, debugRead };
  if (!element) {
    finishEmptySelectionRead(session, read);
    return undefined;
  }
  return read;
}

export function writeInFlight(reader: SelectionReader): boolean {
  return Boolean(reader.localWritePendingRef.current || reader.writeTimerRef.current !== undefined || reader.dragTargetRef.current);
}

export function forgetPreviousElement(reader: SelectionReader, nextElementKey: string | undefined): void {
  const { selectedElementKeyRef, selectedClassNamesRef, selectionIsDefaultRef } = reader;
  const { cascadeWinnerCacheRef, localWritePendingRef } = reader;
  selectedElementKeyRef.current = nextElementKey;
  selectedClassNamesRef.current = [];
  selectionIsDefaultRef.current = true;
  cascadeWinnerCacheRef.current = undefined;
  reader.setSelectedClassNames([]);
  reader.clearPendingWrite();
  localWritePendingRef.current = false;
  loadNoneIfChanged(reader, { force: true });
}

export function finishEmptySelectionRead(session: SelectionSession, read: SelectionRead): void {
  const reader = session.readerRef.current;
  if (read.debugRead) {
    debugClipPath('readSelectedElement:no-element');
  }
  if (isCurrentRead(session, read)) {
    reader.setElementClassNames([]);
    reader.selectedClassNamesRef.current = [];
    reader.selectionIsDefaultRef.current = true;
    reader.setSelectedClassNames([]);
    loadNoneIfChanged(reader, { force: read.force });
  }
  if (read.readSeq === reader.selectionReadSeqRef.current) {
    reader.selectionReadInProgressRef.current = false;
  }
}

export async function readElementClipPath(session: SelectionSession, read: SelectionRead, element: unknown): Promise<void> {
  const found = await readElementStyles(session, read, element);
  if (!found) {
    return;
  }
  const defaultStyle = await followDefaultSelection(session, read, found);
  if (defaultStyle === 'stale') {
    return;
  }
  const target = await targetSelectedClasses(session, read, {
    ...found,
    selectedStyle: defaultStyle,
  });
  if (target.kind === 'done') {
    return;
  }
  const selectedStyle = await applySelectedStyle(session, read, found, target);
  if (!selectedStyle) {
    return;
  }
  await loadSelectedShape(session, read, found, {
    selectedStyle,
    refineKey: target.inheritedWinnerRefineKey,
  });
}

export async function readElementStyles(session: SelectionSession, read: SelectionRead, element: unknown): Promise<ElementStyles | undefined> {
  const reader = session.readerRef.current;
  const styleOptions = styleOptionsForBreakpoint(reader.activeBreakpointRef.current);
  const styles = await getElementPrimaryStyleHandles(element);
  if (!isCurrentRead(session, read)) {
    return undefined;
  }
  let selectedStyle = await findClipPathStyle(styles, styleOptions);
  const classNames = await getElementClassNames(element, styles);
  if (isCurrentRead(session, read)) {
    reader.setElementClassNames(classNames);
  }
  dropRemovedSelectedClasses(session, read, classNames);
  if (read.debugRead) {
    debugClipPath('readSelectedElement:primary-styles', {
      classNames,
      lookupCandidates: getStyleLookupCandidates(classNames),
      styles: await debugStyleSummaries(styles, styleOptions),
      selectedStyle: selectedStyle ? await debugStyleSummary(selectedStyle.style, styleOptions) : undefined,
      selectedRaw: selectedStyle?.raw || undefined,
      selectedBreakpoint: selectedStyle?.breakpoint || undefined,
    });
  }
  const found = { styles, classNames, selectedStyle, styleOptions };
  if (!hasClipPathDeclaration(selectedStyle?.raw)) {
    const fromClasses = await lookupClassClipPathStyle(session, read, found);
    if (fromClasses === 'stale') {
      return undefined;
    }
    selectedStyle = fromClasses;
  }
  if (!isCurrentRead(session, read)) {
    return undefined;
  }
  return { ...found, selectedStyle };
}

export function dropRemovedSelectedClasses(session: SelectionSession, read: SelectionRead, classNames: string[]): void {
  const reader = session.readerRef.current;
  if (!reader.selectedClassNamesRef.current.some((name) => !classNames.includes(name))) {
    return;
  }
  const stillPresent = reader.selectedClassNamesRef.current.filter((name) => classNames.includes(name));
  reader.selectedClassNamesRef.current = stillPresent;
  if (isCurrentRead(session, read)) {
    reader.setSelectedClassNames(stillPresent);
  }
}

export async function lookupClassClipPathStyle(
  session: SelectionSession,
  read: SelectionRead,
  { styles, classNames, selectedStyle, styleOptions }: ElementStyles,
): Promise<FoundClipPathStyle | 'stale'> {
  if (read.debugRead) {
    debugClipPath('readSelectedElement:class-lookup-start', {
      classNames,
      lookupCandidates: getStyleLookupCandidates(classNames),
    });
  }
  const classLookup = await getClassStyleHandlesWithDiagnostics(classNames, session.webflowApi);
  const classStyles = classLookup.styles;
  if (!isCurrentRead(session, read)) {
    return 'stale';
  }
  let classSelectedStyle: FoundClipPathStyle = undefined;
  let nextSelectedStyle = selectedStyle;
  if (classStyles.length) {
    classSelectedStyle = await findClipPathStyle([...classStyles, ...styles], styleOptions);
    if (hasClipPathDeclaration(classSelectedStyle?.raw) || !selectedStyle) {
      nextSelectedStyle = classSelectedStyle;
    }
  }
  if (read.debugRead) {
    debugClipPath('readSelectedElement:class-styles', {
      lookupResults: classLookup.diagnostics,
      classStyles: await debugStyleSummaries(classStyles, styleOptions),
      classSelectedStyle: classSelectedStyle ? await debugStyleSummary(classSelectedStyle.style, styleOptions) : undefined,
      classSelectedRaw: classSelectedStyle?.raw || undefined,
      classSelectedBreakpoint: classSelectedStyle?.breakpoint || undefined,
      finalSelectedRaw: nextSelectedStyle?.raw || undefined,
      finalSelectedBreakpoint: nextSelectedStyle?.breakpoint || undefined,
    });
  }
  return nextSelectedStyle;
}

export async function followDefaultSelection(session: SelectionSession, read: SelectionRead, found: ElementStyles): Promise<FoundClipPathStyle | 'stale'> {
  const reader = session.readerRef.current;
  if (!reader.selectionIsDefaultRef.current) {
    return found.selectedStyle;
  }
  const winner = hasClipPathDeclaration(found.selectedStyle?.raw)
    ? await resolveCascadeWinnerClipPathStyle(found.classNames, found.styles, found.styleOptions, session.webflowApi)
    : undefined;
  if (!isCurrentRead(session, read)) {
    return 'stale';
  }
  const defaultSelection = winner ? winner.namePath.filter((name) => found.classNames.includes(name)) : [];
  const current = reader.selectedClassNamesRef.current;
  const changed = defaultSelection.length !== current.length || defaultSelection.some((name, index) => name !== current[index]);
  if (changed) {
    reader.selectedClassNamesRef.current = defaultSelection;
    reader.setSelectedClassNames(defaultSelection);
  }
  return winner ? { style: winner.style, raw: winner.raw, breakpoint: winner.breakpoint } : found.selectedStyle;
}

export type SelectedClassTarget =
  | { kind: 'done' }
  | {
      kind: 'style';
      selectedStyle: FoundClipPathStyle;
      selectedNames: string[];
      writeStyleHandle: StyleHandle | undefined;
      originOverride: ClipPathStyleOrigin | undefined;
      appliedNameOverride: { name: string | undefined } | undefined;
      inheritedWinnerRefineKey: string | undefined;
    };
export type ClassStyleTarget = Extract<SelectedClassTarget, { kind: 'style' }>;

export async function targetSelectedClasses(session: SelectionSession, read: SelectionRead, found: ElementStyles): Promise<SelectedClassTarget> {
  const reader = session.readerRef.current;
  const selectedNames = reader.selectedClassNamesRef.current;
  const untargeted: ClassStyleTarget = {
    kind: 'style',
    selectedStyle: found.selectedStyle,
    selectedNames,
    writeStyleHandle: undefined,
    originOverride: undefined,
    appliedNameOverride: undefined,
    inheritedWinnerRefineKey: undefined,
  };
  if (!selectedNames.length) {
    return untargeted;
  }
  const targetStyle = await findStyleForClassPath(selectedNames, session.webflowApi);
  if (!isCurrentRead(session, read)) {
    return { kind: 'done' };
  }
  const targetDeclaration = targetStyle ? await readClipPathDeclarationWithSource(targetStyle, found.styleOptions) : undefined;
  if (!isCurrentRead(session, read)) {
    return { kind: 'done' };
  }
  if (targetStyle && targetDeclaration && hasClipPathDeclaration(targetDeclaration.value)) {
    return {
      ...untargeted,
      writeStyleHandle: targetStyle,
      selectedStyle: {
        style: targetStyle,
        raw: targetDeclaration.value,
        breakpoint: targetDeclaration.breakpoint,
      },
      appliedNameOverride: { name: selectedNames[selectedNames.length - 1] ?? undefined },
    };
  }
  if (hasClipPathDeclaration(found.selectedStyle?.raw)) {
    return inheritForSelectedClasses(session, read, found, {
      ...untargeted,
      writeStyleHandle: targetStyle,
    });
  }
  loadNoneForWritableStyle(reader, targetStyle, { force: read.force });
  return { kind: 'done' };
}

export function inheritForSelectedClasses(session: SelectionSession, read: SelectionRead, found: ElementStyles, target: ClassStyleTarget): ClassStyleTarget {
  const reader = session.readerRef.current;
  if (isCurrentRead(session, read)) {
    reader.setClipPathStyleOrigin('inherited');
  }
  const inherited: ClassStyleTarget = { ...target, originOverride: 'inherited' };
  const winnerKey = `${found.classNames.join('\u0000')}|` + `${found.selectedStyle?.style?.id ?? ''}|${found.selectedStyle?.raw ?? ''}`;
  const cached = reader.cascadeWinnerCacheRef.current;
  if (cached && cached.key === winnerKey) {
    if (!cached.winner) {
      return inherited;
    }
    return {
      ...inherited,
      selectedStyle: {
        style: cached.winner.style,
        raw: cached.winner.raw,
        breakpoint: cached.winner.breakpoint,
      },
    };
  }
  return { ...inherited, inheritedWinnerRefineKey: winnerKey };
}

export async function applySelectedStyle(
  session: SelectionSession,
  read: SelectionRead,
  found: ElementStyles,
  target: ClassStyleTarget,
): Promise<NonNullable<FoundClipPathStyle> | undefined> {
  const reader = session.readerRef.current;
  const { selectedStyle } = target;
  if (!selectedStyle) {
    if (read.debugRead) {
      debugClipPath('readSelectedElement:result-none-no-style');
    }
    loadNoneIfChanged(reader, { force: read.force });
    return undefined;
  }
  if (!hasClipPathDeclaration(selectedStyle.raw)) {
    if (read.debugRead) {
      debugClipPath('readSelectedElement:result-none-writable-style', {
        style: await debugStyleSummary(selectedStyle.style, found.styleOptions),
      });
    }
    loadNoneForWritableStyle(reader, selectedStyle.style, { force: read.force });
    return undefined;
  }
  reader.styleRef.current = target.selectedNames.length ? target.writeStyleHandle : target.writeStyleHandle || selectedStyle.style;
  reader.setClipPathStyleOrigin(target.originOverride || clipPathStyleOriginFromSource(selectedStyle.breakpoint, reader.activeBreakpointRef.current));
  const sourceNamePath = await getStyleNamePath(selectedStyle.style);
  if (isCurrentRead(session, read)) {
    const sourceClasses = sourceNamePath.filter((name) => found.classNames.includes(name));
    reader.setClipPathSourceSelector(sourceClasses.length ? sourceClasses : sourceNamePath);
    reader.setClipPathSourceBreakpoint(selectedStyle.breakpoint);
    reader.setAppliedClassName(target.appliedNameOverride ? target.appliedNameOverride.name : sourceNamePath[sourceNamePath.length - 1] || undefined);
  }
  return selectedStyle;
}

export async function loadSelectedShape(
  session: SelectionSession,
  read: SelectionRead,
  found: ElementStyles,
  { selectedStyle, refineKey }: { selectedStyle: NonNullable<FoundClipPathStyle>; refineKey: string | undefined },
): Promise<void> {
  const reader = session.readerRef.current;
  const normalized = normalizeClipPathValue(selectedStyle.raw);
  if (read.debugRead) {
    debugClipPath('readSelectedElement:result-detected', {
      raw: selectedStyle.raw,
      normalizedCss: normalized.css,
      preset: matchPreset(normalized.shape),
      sourceBreakpoint: selectedStyle.breakpoint,
      style: await debugStyleSummary(selectedStyle.style, found.styleOptions),
    });
  }
  const loadedShapeScaleOptions = loadedShapeScaleOptionsFor(reader, normalized.shape);
  let rawShapeSvgCache: PastedShapeSvgCache | undefined = undefined;
  if (normalized.shape.kind === 'shape') {
    rawShapeSvgCache =
      reader.matchingPastedSvgCacheForShape(normalized.shape, loadedShapeScaleOptions) ||
      (await readPastedShapeMetadata(selectedStyle.style, found.styleOptions)) ||
      cacheFromShapeFitVariants(normalized.shape, loadedShapeScaleOptions);
  }
  const shapeSvgCache = normalizeShapeFitCache(rawShapeSvgCache, loadedShapeScaleOptions);
  const loadedShape =
    normalized.shape.kind === 'shape' && rawShapeSvgCache && shapeSvgCache && shapesClose(normalized.shape, rawShapeSvgCache.contain)
      ? shapeSvgCache.contain
      : normalized.shape;
  if (!isCurrentRead(session, read)) {
    return;
  }
  if (refineKey) {
    void refineInheritedWinner(session, read, found, refineKey);
  }
  const unchanged = reader.lastWrittenRef.current === normalized.css && shapesClose(reader.shapeRef.current, loadedShape);
  if (!unchanged) {
    reader.loadShapeFromSelection(loadedShape, normalized.css);
  }
  if (shapeSvgCache && reader.shapeMatchesPastedSvgCache(loadedShape, shapeSvgCache)) {
    reader.pastedShapeSvgCacheRef.current = shapeSvgCache;
  }
}

export function loadedShapeScaleOptionsFor(reader: SelectionReader, shape: ClipShape): ShapeScaleOptions {
  const loadedScaleVariableName = shape.kind === 'shape' ? shapeScaleVariableNameFromValue(shape.value) : undefined;
  const loadedOffsetNames = shape.kind === 'shape' ? shapeOffsetVariableNamesFromValue(shape.value) : undefined;
  if (!loadedScaleVariableName) {
    return reader.currentShapeScaleOptions({ useVariable: false });
  }
  return {
    useVariable: true,
    variableName: loadedScaleVariableName,
    offsetLeftVariableName: loadedOffsetNames?.offsetLeftVar || DEFAULT_SHAPE_OFFSET_LEFT_VARIABLE_NAME,
    offsetTopVariableName: loadedOffsetNames?.offsetTopVar || DEFAULT_SHAPE_OFFSET_TOP_VARIABLE_NAME,
  };
}

export async function refineInheritedWinner(session: SelectionSession, read: SelectionRead, found: ElementStyles, refineKey: string): Promise<void> {
  const winner = await resolveCascadeWinnerClipPathStyle(found.classNames, found.styles, found.styleOptions, session.webflowApi);
  if (!isCurrentRead(session, read)) {
    return;
  }
  const reader = session.readerRef.current;
  reader.cascadeWinnerCacheRef.current = { key: refineKey, winner };
  const winnerCss = winner ? normalizeClipPathValue(winner.raw).css : undefined;
  if (winnerCss && winnerCss !== reader.lastWrittenRef.current) {
    reader.refreshSelectedElementRef.current?.({ force: true });
  }
}
