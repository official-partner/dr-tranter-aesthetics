import { outsideScope } from '../../../shared/properties/deepOutline';
import { canvasHighlight, deepHoverNode, subscribeCanvasHighlight } from '../../ui/canvasOutlineMode';
import type { CanvasHighlight } from '../../../shared/properties/deepOutline';
import React, { useSyncExternalStore } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { assert } from '../../../shared/core/assert';
import { pseudoPath, type PseudoLayer } from '../../../shared/page/pseudoPath';
import type { Box } from './outlineBoxes';
import type { PreviewMessage } from './previewMessages';
import { outlineKind, type OutlineKind } from '../../../shared/properties/outlineOwnership';
import { NO_TEXT_MARKS, type TextMarkBox, type TextMarks } from './previewMessages';
import { ownerClasses } from './textOwnerState';
import { copiesToDraw, hoverIsSelection, loopChildPaths, collapseKind, onePerPlace, outlineBoxPath, unionBox } from './outlineBoxes';
import { clipBand, spacingBands, withLiveSpacing, type CollapsePartner } from './spacingBands';
import {
  BranchIcon,
  CodeIcon,
  PseudoElementIcon,
  CommentIcon,
  ComponentEditIcon,
  CornerIcon,
  CustomElementIcon,
  ElementComponentIcon,
  LayoutIcon,
  RepeatIcon,
  TextIcon,
  astroAssetIcon,
  elementIcon,
} from '../../ui/Icons';

export interface OverlayInfo {
  readonly label: string;
  readonly kind: 'component' | 'map' | 'element';
  readonly tag: string | undefined;
  readonly astroAsset: boolean;
  readonly dynamicTag: boolean;
  readonly nodeKind: string;
  readonly childCount: number;
  readonly isLayout: boolean;
  readonly bound: boolean;
  readonly hostContent?: boolean | undefined;
}

export interface SpacingHover {
  readonly kind: 'padding' | 'margin' | 'gap';
  readonly sides?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
  readonly live?: Readonly<Record<string, string>>;
}

type RectsMessage = Extract<PreviewMessage, { readonly kind: 'rects' }>;
export type RectMap = RectsMessage['rects'];
export type SpacingMap = RectsMessage['spacing'];

interface PreviewOverlaysProps {
  readonly rects: RectMap;
  readonly spacing: SpacingMap;
  readonly scale: number;
  readonly viewport?: { readonly w: number; readonly h: number } | undefined;
  readonly spacingHover?: SpacingHover | undefined;
  readonly selPath: string | undefined;
  readonly selOcc: number | undefined;
  readonly hoverPath: string | undefined;
  readonly hoverOcc: number | undefined;
  readonly selPseudo?: PseudoLayer | undefined;
  readonly hoverPseudo?: PseudoLayer | undefined;
  readonly focusPath: string | undefined;
  readonly focusWhole: boolean;
  readonly textMarks?: TextMarks | undefined;
  readonly overlayInfo?: (path: string) => OverlayInfo | undefined;
  readonly onOpenComponent?: ((path: string, occurrence: number) => void) | undefined;
  readonly pathScope?: string | undefined;
}

export function deepOutlineInfo(path: string): OverlayInfo | undefined {
  const node = deepHoverNode(path);
  if (node === undefined) {
    return undefined;
  }
  return {
    label: node.label,
    kind: node.kind,
    tag: node.tag,
    astroAsset: false,
    dynamicTag: false,
    nodeKind: node.kind,
    childCount: 0,
    isLayout: false,
    bound: false,
  };
}

export function PreviewOverlays(props: PreviewOverlaysProps) {
  const highlight = useSyncExternalStore(subscribeCanvasHighlight, canvasHighlight, canvasHighlight);
  return (
    <>
      {!props.focusWhole && <FocusOverlays path={props.focusPath} rects={props.rects} scale={props.scale} />}
      <SpacingOverlays {...props} />
      <NodeOutlines {...props} />
      <TextMarkOutlines marks={props.textMarks ?? NO_TEXT_MARKS} instances={outlineBoxes(props, highlight)} scale={props.scale} />
    </>
  );
}

function FocusOverlays({ path, rects, scale }: { readonly path: string | undefined; readonly rects: RectMap; readonly scale: number }) {
  if (!path) {
    return undefined;
  }
  return onePerPlace(rects[path] ?? undefined).map((box, index) => <div key={`focus-${index}`} className="node-focus" style={boxStyle(box, scale)} />);
}

function SpacingOverlays(props: PreviewOverlaysProps) {
  const translate = useTranslate();
  const { spacingHover, selPath: selectedPath } = props;
  if (!spacingHover || !selectedPath) {
    return undefined;
  }
  const boxes = props.rects[selectedPath] ?? [];
  const measurements = props.spacing[selectedPath] ?? [];
  const box = boxes[props.selOcc ?? 0] ?? boxes[0];
  if (box?.hidden === true) {
    return undefined;
  }
  const measurement = measurements[props.selOcc ?? 0] ?? measurements[0] ?? undefined;
  const sized = withLiveSpacing(measurement, spacingHover.kind, spacingHover.live);
  return spacingBands(box, sized, spacingHover.kind, spacingHover.sides).flatMap((drawn, index) => {
    const band = clipBand(drawn, props.viewport);
    if (!band) {
      return [];
    }
    const collapsed = band.collapsedInto;
    const label = collapsed === undefined ? (spacingHover.labels?.[band.side] ?? spacingLabel(band)) : translate(collapseKey(collapsed));
    return [
      <div
        key={`sp-${band.side}-${index}`}
        className={`spacing-band is-${spacingHover.kind}${collapsed === undefined ? '' : ` is-collapsed is-${band.side}`}`}
        style={boxStyle(band, props.scale)}
      >
        <span className="spacing-band-label">{label}</span>
      </div>,
    ];
  });
}

function collapseKey(partner: CollapsePartner) {
  switch (partner) {
    case 'previous':
      return 'preview.spacing.collapsedPrevious';
    case 'next':
      return 'preview.spacing.collapsedNext';
    case 'parent':
      return 'preview.spacing.collapsedParent';
    default: {
      const exhaustive: never = partner;
      return exhaustive;
    }
  }
}

function NodeOutlines(props: PreviewOverlaysProps) {
  const highlight = useSyncExternalStore(subscribeCanvasHighlight, canvasHighlight, canvasHighlight);
  const targets = outlineTargets(props, highlight);
  const slotHover =
    highlight === undefined && props.hoverPath && props.hoverPseudo === undefined && !targets.some((target) => target.slot === 'hover')
      ? props.overlayInfo?.(props.hoverPath)?.hostContent === true
      : false;
  const outlines: readonly OutlineTarget[] = slotHover
    ? [{ path: props.hoverPath ?? '', slot: 'hover', type: 'hover', occ: props.hoverOcc, pseudo: undefined }, ...targets]
    : targets;
  return outlines.flatMap((outline) => {
    if (outline.pseudo !== undefined) {
      const kind = outlineKind({
        insideComponent: outsideScope(outline.path, props.pathScope ?? ''),
        insideSlot: false,
        nodeKind: props.overlayInfo?.(outline.path)?.kind === 'component' ? 'component' : 'element',
      });
      return <PseudoOutline key={`${outline.slot}-pseudo`} outline={outline} rects={props.rects} scale={props.scale} kind={kind} />;
    }
    const info =
      outline.slot !== 'sel' && outsideScope(outline.path, props.pathScope ?? '') ? deepOutlineInfo(outline.path) : props.overlayInfo?.(outline.path);
    const geometryPath = outlineBoxPath(outline.path, info?.nodeKind);
    const all = props.rects[geometryPath] ?? props.rects[outline.path];
    if (!all || !info) {
      return [];
    }
    const loop = info.nodeKind === 'map' ? loopBox(props.rects, outline.path, info.childCount) : undefined;
    const boxes = loop !== undefined ? [loop] : copiesToDraw(all, outline.occ);
    const muted = info.hostContent && outline.type === 'hover';
    const kind = outlineKind({
      insideComponent: false,
      insideSlot: false,
      nodeKind: info.kind === 'element' && ownsMarkedWords(props.textMarks, outline.path) ? 'component' : info.kind,
    });
    return boxes.map((box, index) => {
      const collapse = collapseKind(box);
      return (
        <div
          key={`${outline.slot}-${index}`}
          className={`node-outline ${outline.type} ${kind}${info.bound ? ' bound' : ''}${muted ? ` host-content${props.selPath === outline.path ? ' is-selected' : ''}` : ''}${collapse === 'none' ? '' : ` collapsed is-${collapse}`}${ownerClasses(
            props.textMarks,
            {
              ownable: kind === 'component' && !info.isLayout,
              path: outline.path,
              slot: outline.slot === 'highlight' ? 'highlight' : outline.type === 'sel' ? 'sel' : 'hover',
              pointedAt: props.hoverPath === outline.path,
            },
          )}`}
          style={boxStyle(box, props.scale)}
        >
          <span className={`node-outline-tag ${box.y * props.scale < 20 ? 'inside' : ''}`}>
            {outlineIcon(info)}
            {info.label}
            {outline.slot === 'sel' && <ComponentEditButton info={info} path={outline.path} occurrence={all.indexOf(box)} onOpen={props.onOpenComponent} />}
            {}
            {outline.slot === 'highlight' && outline.type === 'sel' && info.kind === 'component' && (
              <span className="node-outline-edit" aria-hidden="true">
                <ComponentEditIcon size={12} />
              </span>
            )}
          </span>
        </div>
      );
    });
  });
}

function markKind(box: TextMarkBox): OutlineKind {
  return outlineKind({ insideComponent: true, insideSlot: box.owner === 'slot', nodeKind: 'element' });
}

function ownsMarkedWords(marks: TextMarks | undefined, path: string): boolean {
  return marks?.hover?.scope === path || marks?.picked?.scope === path;
}

function ComponentEditButton({
  info,
  path,
  occurrence,
  onOpen,
}: {
  readonly info: OverlayInfo;
  readonly path: string;
  readonly occurrence: number;
  readonly onOpen: PreviewOverlaysProps['onOpenComponent'];
}) {
  const translate = useTranslate();
  if (info.kind !== 'component') {
    return undefined;
  }
  if (info.astroAsset) {
    return undefined;
  }
  if (info.dynamicTag) {
    return undefined;
  }
  if (!onOpen) {
    return undefined;
  }
  return (
    <button
      type="button"
      className="node-outline-edit"
      aria-label={translate('preview.overlay.editComponent', { name: info.label })}
      data-tooltip={translate('preview.overlay.editTip')}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(path, occurrence);
      }}
    >
      <ComponentEditIcon size={12} />
    </button>
  );
}

interface OutlineTarget {
  readonly path: string;
  readonly slot: 'hover' | 'sel' | 'highlight';
  readonly type: 'hover' | 'sel';
  readonly occ: number | undefined;
  readonly pseudo: PseudoLayer | undefined;
}

function outlineTargets(props: PreviewOverlaysProps, highlight: CanvasHighlight | undefined): readonly OutlineTarget[] {
  const targets: OutlineTarget[] = [];
  if (highlight !== undefined) {
    targets.push({
      path: highlight.path,
      slot: 'highlight',
      type: highlight.style === 'hover' ? 'hover' : 'sel',
      occ: highlight.occurrence,
      pseudo: undefined,
    });
  } else if (props.hoverPath) {
    const samePseudo = props.hoverPseudo === props.selPseudo;
    if (!samePseudo || !hoverIsSelection({ path: props.hoverPath, occ: props.hoverOcc }, { path: props.selPath, occ: props.selOcc })) {
      targets.push({ path: props.hoverPath, slot: 'hover', type: 'hover', occ: props.hoverOcc, pseudo: props.hoverPseudo });
    }
  }
  if (props.selPath) {
    targets.push({ path: props.selPath, slot: 'sel', type: 'sel', occ: props.selOcc, pseudo: props.selPseudo });
  }
  return targets;
}

function PseudoOutline({
  outline,
  rects,
  scale,
  kind,
}: {
  readonly outline: OutlineTarget;
  readonly rects: RectMap;
  readonly scale: number;
  readonly kind: OutlineKind;
}) {
  assert(outline.pseudo !== undefined, 'PseudoOutline: the outline is a pseudo-element');
  const all = rects[pseudoPath(outline.path, outline.pseudo)];
  if (!all) {
    return [];
  }
  const boxes = copiesToDraw(all, outline.occ);
  return boxes.map((box, index) => (
    <div key={`${outline.type}-pseudo-${index}`} className={`node-outline ${outline.type} pseudo ${kind}`} style={boxStyle(box, scale)}>
      <span className={`node-outline-tag ${box.y * scale < 20 ? 'inside' : ''}`}>
        <PseudoElementIcon size={11} />
        ::{outline.pseudo}
      </span>
    </div>
  ));
}

export function outlineIcon(info: OverlayInfo): React.ReactNode {
  const size = 11;
  if (info.isLayout) {
    return <LayoutIcon size={size} />;
  }
  if (info.nodeKind === 'component') {
    if (info.kind === 'element') {
      return <CustomElementIcon size={size} />;
    }
    return info.astroAsset ? astroAssetIcon(info.label, size, undefined, 'inherit') : <ElementComponentIcon size={size} />;
  }
  switch (info.nodeKind) {
    case 'map':
      return <RepeatIcon size={size} />;
    case 'cond':
      return <BranchIcon size={size} />;
    case 'branch':
      return <CornerIcon size={size} />;
    case 'text':
      return <TextIcon size={size} />;
    case 'comment':
      return <CommentIcon size={size} />;
    case 'expr':
    case 'raw':
      return <CodeIcon size={size} />;
    default:
      return info.tag ? elementIcon(info.tag, size) : <CustomElementIcon size={size} />;
  }
}

function TextMarkOutlines({ marks, instances, scale }: { readonly marks: TextMarks; readonly instances: readonly Box[]; readonly scale: number }) {
  const drawn = [
    ...(marks.hover && !sameBox(marks.hover, marks.picked) ? [['hover', marks.hover] as const] : []),
    ...(marks.picked ? [['sel', marks.picked] as const] : []),
  ];
  return drawn.map(([type, box]) => (
    <div key={type} className={`node-outline ${type} ${markKind(box)} text-mark`} style={boxStyle(box, scale)}>
      {!instances.some((instance) => tagsCollide(instance, box, scale)) && (
        <span className={`node-outline-tag ${box.y * scale < 20 ? 'inside' : ''}`}>
          {box.kind === 'component' ? <ElementComponentIcon size={11} /> : <TextIcon size={11} />}
          {box.label}
        </span>
      )}
    </div>
  ));
}

function outlineBoxes(props: PreviewOverlaysProps, highlight: CanvasHighlight | undefined): readonly Box[] {
  const boxes: Box[] = [];
  for (const outline of outlineTargets(props, highlight)) {
    if (outline.pseudo !== undefined) {
      continue;
    }
    const info = props.overlayInfo?.(outline.path);
    const all = props.rects[outlineBoxPath(outline.path, info?.nodeKind)] ?? props.rects[outline.path];
    if (all === undefined) {
      continue;
    }
    const loop = info?.nodeKind === 'map' ? loopBox(props.rects, outline.path, info.childCount) : undefined;
    boxes.push(...(loop !== undefined ? [loop] : copiesToDraw(all, outline.occ)));
  }
  return boxes;
}

function tagsCollide(instance: Box, mark: Box, scale: number): boolean {
  assert(scale > 0, 'Overlay scale must be positive');
  const horizontalPx = Math.abs(instance.x - mark.x) * scale;
  const verticalPx = Math.abs(instance.y - mark.y) * scale;
  if (horizontalPx < TAG_HEIGHT_PX) {
    return verticalPx < TAG_HEIGHT_PX;
  }
  return false;
}

function sameBox(left: Box, right: Box | undefined): boolean {
  if (!right) {
    return false;
  }
  return left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

const TAG_HEIGHT_PX = 18;

function boxStyle(box: Box, scale: number): React.CSSProperties {
  return {
    left: box.x * scale,
    top: box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
  };
}

function spacingLabel(box: Box & { readonly side: string }): string {
  const horizontal = box.side === 'left' || box.side === 'right';
  return `${Math.round(horizontal ? box.w : box.h)}px`;
}

function loopBox(rects: RectMap, path: string, childCount: number): Box | undefined {
  return unionBox(loopChildPaths(path, childCount).flatMap((child) => rects[child] ?? []));
}
