import { Component, Suspense, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { assert } from '../../../../shared/core/assert';
import { SLOT_MARK, slotOfMarked, type ValueSlot } from '../../../../shared/properties/valueSlot';
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { SkeletonRows } from '../../../ui/Skeleton';
import { BoxShadowEditor, BoxShadowsRow } from '../BoxShadowsRow';
import { LayerEditor, isGradientType } from '../BackgroundLayerEditor';
import { typeOptions } from '../BackgroundLayerFields';
import { layerRow } from '../BackgroundSection';
import { PlusIcon } from '../components/MenuParts';
import LayerList, { LayerListOpensSingleRow } from '../LayerList';
import SegmentedControl from '../../../ui/SegmentedControl';
import { blankLayer, parseLayers, serializeLayers, type BgLayer, type LayerKind } from '../model/background';
import { openAfterRemoval } from '../model/fieldHooks';
import { displayOf } from '../model/styleDisplay';
import { ClipPathEditor } from '../ClipPathRow';
import ColorPicker from '../components/ColorPicker';
import EasingEditor from '../EasingEditor';
import { EffLabel, type Props as StyleRowProps } from '../EffectsKit';
import GradientEditor from '../GradientEditor';
import LayerPopover from '../LayerPopover';
import { ShadowEditor, TextShadowsRow } from '../TextStrokeShadow';
import { FiltersRow, TransformsRow } from '../TransformsRow';
import { TransitionsRow } from '../TransitionsRow';
import { useHoverPreview as usePickerHoverPreview, VariablePicker } from '../VariablePicker';
import { previewNowhere, PreviewPropContext } from '../connectFieldHelpers';
import { hoverStyle } from '../model/liveRuleEdits';
import { useSharedVars } from '../sharedVars';
import { rootSwatchScope, subscribeRootColors, SwatchScopeContext } from '../model/computedColor';
import { declaredPropertyAt } from '../model/panelVariableList';
import { usePanelListing } from '../usePanelListing';
import { parseBoxShadows, serializeBoxShadows, type BoxShadow } from '../model/boxShadow';
import { blankGradientOf, parseGradient, serializeGradient, type Gradient, type GradientType } from '../model/gradient';
import type { ResolvedProp } from '../model/resolved';
import { parseShadows, serializeShadows, type Shadow } from '../model/textShadow';
import { isEasing } from '../model/transition';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { check as centralCheck } from '../../../ui/central/centralGeometry';
import '../../../ui/menu.css';
import { KeywordChipControl, keywordControlOf } from './KeywordChipControl';
import { isKeywordOf, keywordChoices, type KeywordPropertyName } from './keywordOptions';
import { useChipTyping } from './ChipTypingChooser';
import { CANVAS_WRITER, useChipPreview, valueAround } from './chipPreview';
import { codeChipsExtension, refreshCodeChips, setOpenChip, writeChipValue, type CodeChipHandlers, type CodeChipRequest } from './codeChipsExtension';
import type { CssChipText, CssValueChip, LayeredProperty } from './cssValueChips';
import '../embedEditor.css';


export interface CodeChips {
  readonly extension: Extension;
  readonly overlay: ReactNode;
}

interface OpenChip {
  readonly view: EditorView;
  readonly chip: CssValueChip;
  readonly anchor: HTMLElement;
  readonly anchorRect: DOMRect;
}

const LIVE_WRITE_MS = 120;
export const CHIP_POPOVER_WIDTH_PX = 340;
export const CLIP_PATH_POPOVER_WIDTH_PX = 360;
const EASING_FRAME_WIDTH_PX = 360;
export const CHIP_POPOVER_EDGE_PX = 8;

export class ChipPopoverBoundary extends Component<{ readonly onFailure: () => void; readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[code chips] a chip’s popup failed and was closed', error, info.componentStack);
    this.props.onFailure();
  }

  override render(): ReactNode {
    return this.state.failed ? undefined : this.props.children;
  }
}

export function codeChipTextOf(language: string | undefined): CssChipText | undefined {
  if (language === 'css') {
    return 'stylesheet';
  }
  if (language === 'astro' || language === 'html') {
    return 'markup';
  }
  return undefined;
}

export function chipPopoverSpan(anchor: Pick<DOMRect, 'left'>, widthPx: number, windowWidthPx: number): { readonly left: number; readonly width: number } {
  assert(widthPx > 0, 'chipPopoverSpan: a popup has a width');
  assert(windowWidthPx >= 0, 'chipPopoverSpan: the window has a width');
  const room = Math.max(0, windowWidthPx - CHIP_POPOVER_EDGE_PX * 2);
  const width = Math.min(widthPx, room);
  const left = Math.max(CHIP_POPOVER_EDGE_PX, Math.min(anchor.left, windowWidthPx - CHIP_POPOVER_EDGE_PX - width));
  assert(width <= widthPx, 'chipPopoverSpan: a popup is never wider than asked');
  return { left, width };
}

export type CodeChipsTyping = 'offered' | 'elsewhere';

export function useCodeChips(text: CssChipText | undefined, options: { readonly typing?: CodeChipsTyping } = {}): CodeChips {
  const translate = useTranslate();
  const [open, setOpen] = useState<OpenChip | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  const { vars, loading } = useSharedVars({ active: text !== undefined });
  const typing = useChipTyping(options.typing === 'elsewhere' ? undefined : text, { vars, loading });
  const views = useRef(new Set<EditorView>());
  const latest = useRef({ text, vars, translate });
  latest.current = { text, vars, translate };
  const handlersRef = useRef<CodeChipHandlers>({
    text: () => latest.current.text,
    variables: () => latest.current.vars,
    translate: () => latest.current.translate,
    onOpen: (request) => {
      if (request.view.state.readOnly) {
        return;
      }
      setOpen(openFrom(request, openRef.current));
    },
    onView: (view, presence) => {
      if (presence === 'mounted') {
        views.current.add(view);
      } else {
        views.current.delete(view);
      }
    },
  });
  const [chipExtension] = useState(() => codeChipsExtension(handlersRef));
  const extension = useMemo(() => [chipExtension, typing.extension], [chipExtension, typing.extension]);
  useEffect(
    () =>
      subscribeRootColors(() => {
        for (const view of views.current) {
          view.dispatch({ effects: refreshCodeChips.of('refresh') });
        }
      }),
    [],
  );
  useEffect(() => {
    for (const view of views.current) {
      view.dispatch({ effects: refreshCodeChips.of('refresh') });
    }
  }, [vars, translate, text]);
  useEffect(() => {
    if (open === undefined) {
      return undefined;
    }
    const { anchor, view, chip } = open;
    const mounted = views.current;
    setOpenChip(view, { from: chip.from, to: chip.to });
    return () => {
      removeStandIn(anchor);
      if (mounted.has(view)) {
        setOpenChip(view, undefined);
      }
    };
  }, [open]);
  const close = (): void => {
    const view = open?.view;
    setOpen(undefined);
    view?.focus();
  };
  const overlay = (
    <>
      {open === undefined ? undefined : (
        <ChipPopoverBoundary key={`${open.chip.kind}|${open.chip.from}`} onFailure={close}>
          <ChipPreviewScope>
            <ChipEditor open={open} vars={vars} onClose={close} />
          </ChipPreviewScope>
        </ChipPopoverBoundary>
      )}
      {typing.overlay}
    </>
  );
  return { extension, overlay };
}

function ChipPreviewScope({ children }: { readonly children: ReactNode }) {
  const outer = useContext(PreviewPropContext);
  const provides = outer === previewNowhere;
  useEffect(() => {
    if (!provides) {
      return undefined;
    }
    return () => hoverStyle.clear(hoverStyle.showing());
  }, [provides]);
  return provides ? <PreviewPropContext.Provider value={CANVAS_WRITER}>{children}</PreviewPropContext.Provider> : children;
}

function openFrom(request: CodeChipRequest, current: OpenChip | undefined): OpenChip | undefined {
  if (current !== undefined && current.view === request.view && current.chip.from === request.chip.from && current.chip.kind === request.chip.kind) {
    return undefined;
  }
  return { view: request.view, chip: request.chip, anchor: standInAnchor(request.anchor), anchorRect: request.anchor };
}

function standInAnchor(rect: DOMRect): HTMLElement {
  const row = document.createElement('span');
  row.className = 'code-chip-anchor';
  row.setAttribute('aria-hidden', 'true');
  Object.assign(row.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
  });
  const anchor = document.createElement('span');
  Object.assign(anchor.style, { display: 'block', width: '100%', height: '100%' });
  row.append(anchor);
  document.body.append(row);
  assert(anchor.parentElement === row, 'standInAnchor: the anchor sits in its own row');
  return anchor;
}

function removeStandIn(anchor: HTMLElement): void {
  (anchor.parentElement ?? anchor).remove();
}

function useLiveWrite(view: EditorView): { readonly write: (value: string) => void; readonly flush: () => void } {
  const pending = useRef<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const flush = (): void => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    const value = pending.current;
    pending.current = undefined;
    if (value !== undefined && value.length > 0) {
      writeChipValue(view, value);
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  const write = (value: string): void => {
    pending.current = value;
    if (timer.current === undefined) {
      flushRef.current();
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        flushRef.current();
      }, LIVE_WRITE_MS);
    }
  };
  return { write, flush };
}

function ChipEditor({
  open,
  vars,
  onClose,
}: {
  readonly open: OpenChip;
  readonly vars: ReturnType<typeof useSharedVars>['vars'];
  readonly onClose: () => void;
}) {
  const { chip } = open;
  switch (chip.kind) {
    case 'variable':
      return <VariableChipEditor open={open} chip={chip} vars={vars} onClose={onClose} />;
    case 'easing':
      return <EasingChipEditor open={open} onClose={onClose} />;
    case 'clipPath':
      return <ClipPathChipEditor open={open} onClose={onClose} />;
    case 'boxShadow':
      return <BoxShadowChipEditor open={open} onClose={onClose} />;
    case 'textShadow':
      return <TextShadowChipEditor open={open} onClose={onClose} />;
    case 'gradient':
      return <GradientChipEditor open={open} onClose={onClose} />;
    case 'color':
      return <ColorChipEditor open={open} onClose={onClose} />;
    case 'layers':
      return <LayersChipEditor open={open} property={chip.property} onClose={onClose} />;
    case 'keyword':
      return <KeywordChipEditor open={open} property={chip.property} onClose={onClose} />;
    default: {
      const exhaustive: never = chip;
      throw new Error(`Assertion failed: ChipEditor: no editor for a chip ${JSON.stringify(exhaustive)}`);
    }
  }
}

function VariableChipEditor({
  open,
  chip,
  vars,
  onClose,
}: {
  readonly open: OpenChip;
  readonly chip: Extract<CssValueChip, { kind: 'variable' }>;
  readonly vars: ReturnType<typeof useSharedVars>['vars'];
  readonly onClose: () => void;
}) {
  const customValue = chip.property === undefined;
  const [self] = useState(() => (customValue ? declaredPropertyAt(open.view.state.doc.toString(), chip.declaration.from) : undefined));
  const listing = usePanelListing({ active: customValue }, self, vars);
  const preview = useChipPreview(
    { property: chip.property, valueWith: (binding) => valueAround(chip, binding, (from, to) => open.view.state.sliceDoc(from, to)) },
    { exits: 'window' },
  );
  return (
    <SwatchScopeContext.Provider value={rootSwatchScope(vars)}>
      <VariablePicker
        anchor={open.anchor}
        vars={listing === undefined ? vars : [...listing.variables]}
        loading={false}
        {...(listing === undefined ? {} : { panel: { blocks: listing.blocks } })}
        {...(chip.property === undefined ? {} : { prop: chip.property })}
        selectedBinding={chip.value}
        {...slotProp(open.view, chip)}
        onPreview={preview.onPreview}
        previewEpoch={preview.previewEpoch}
        onPreviewEnd={preview.onPreviewEnd}
        onPick={(binding) => {
          preview.handOver(binding);
          writeChipValue(open.view, binding);
          onClose();
        }}
        onClose={onClose}
      />
    </SwatchScopeContext.Provider>
  );
}

function slotProp(view: EditorView, chip: Extract<CssValueChip, { kind: 'variable' }>): { readonly slot?: ValueSlot } {
  if (chip.property === undefined) {
    return {};
  }
  const { declaration } = chip;
  assert(declaration.from <= chip.from, 'slotProp: the reference sits in its declaration');
  assert(chip.to <= declaration.to, 'slotProp: the reference ends in its declaration');
  const before = view.state.sliceDoc(declaration.from, chip.from);
  const after = view.state.sliceDoc(chip.to, declaration.to);
  const slot = slotOfMarked(`${before}${SLOT_MARK}${after}`);
  return slot === undefined ? {} : { slot };
}

interface ChipEditorProps {
  readonly open: OpenChip;
  readonly onClose: () => void;
}

function ChipPopover({
  open,
  widthPx,
  label,
  onClose,
  children,
}: {
  readonly open: OpenChip;
  readonly widthPx: number;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [span] = useState(() => chipPopoverSpan(open.anchorRect, widthPx, window.innerWidth));
  return (
    <LayerPopover anchorEl={open.anchor} span={span} onClose={onClose} ariaLabel={label}>
      {children}
    </LayerPopover>
  );
}

function EasingChipEditor({ open, onClose }: ChipEditorProps) {
  const live = useLiveWrite(open.view);
  const [initial] = useState(() => (isEasing(open.chip.value) ? open.chip.value : 'ease'));
  const [frame] = useState(() => chipPopoverSpan(open.anchorRect, EASING_FRAME_WIDTH_PX, window.innerWidth));
  return (
    <EasingEditor
      value={initial}
      frame={frame}
      onChange={live.write}
      onClose={() => {
        live.flush();
        onClose();
      }}
    />
  );
}

function ClipPathChipEditor({ open, onClose }: ChipEditorProps) {
  const translate = useTranslate();
  const live = useLiveWrite(open.view);
  const closeAll = (): void => {
    live.flush();
    onClose();
  };
  return (
    <ChipPopover open={open} widthPx={CLIP_PATH_POPOVER_WIDTH_PX} label={translate('style.clipPathRow.clipPath')} onClose={closeAll}>
      <ClipPathChipBody initialValue={open.chip.value} onApply={live.write} onClear={() => live.write('none')} />
    </ChipPopover>
  );
}

export function ClipPathChipBody({
  initialValue,
  onApply,
  onClear,
}: {
  readonly initialValue: string;
  readonly onApply: (value: string) => void;
  readonly onClear: () => void;
}) {
  const translate = useTranslate();
  return (
    <div className="code-chip-clip">
      <div className="embed-editor_clip-modal-head">
        <span className="embed-editor_clip-modal-title">{translate('style.clipPathRow.clipPath')}</span>
        <div className="embed-editor_clip-modal-actions">
          {}
          <div id="clip-path_header-shortcuts" />
        </div>
      </div>
      <div className="embed-editor_clip-modal-body">
        <Suspense
          fallback={
            <div className="embed-editor_clip-loading">
              <SkeletonRows count={4} />
            </div>
          }
        >
          <ClipPathEditor onApply={onApply} onClear={onClear} hideClassPicker initialValue={initialValue} />
        </Suspense>
      </div>
    </div>
  );
}

function BoxShadowChipEditor({ open, onClose }: ChipEditorProps) {
  const translate = useTranslate();
  const live = useLiveWrite(open.view);
  const [shadow, setShadow] = useState<BoxShadow | undefined>(() => parseBoxShadows(open.chip.value)[0]);
  if (shadow === undefined) {
    return undefined;
  }
  return (
    <ChipPopover
      open={open}
      widthPx={CHIP_POPOVER_WIDTH_PX}
      label={translate('style.boxShadowsRow.boxShadow')}
      onClose={() => {
        live.flush();
        onClose();
      }}
    >
      <BoxShadowEditor
        shadow={shadow}
        busy={false}
        onChange={(patch) => {
          const next = { ...shadow, ...patch };
          setShadow(next);
          live.write(serializeBoxShadows([next]));
        }}
      />
    </ChipPopover>
  );
}

function TextShadowChipEditor({ open, onClose }: ChipEditorProps) {
  const translate = useTranslate();
  const live = useLiveWrite(open.view);
  const [shadow, setShadow] = useState<Shadow | undefined>(() => parseShadows(open.chip.value)[0]);
  if (shadow === undefined) {
    return undefined;
  }
  return (
    <ChipPopover
      open={open}
      widthPx={CHIP_POPOVER_WIDTH_PX}
      label={translate('style.textStrokeShadow.textShadow')}
      onClose={() => {
        live.flush();
        onClose();
      }}
    >
      <ShadowEditor
        shadow={shadow}
        busy={false}
        onChange={(patch) => {
          const next = { ...shadow, ...patch };
          setShadow(next);
          live.write(serializeShadows([next]));
        }}
      />
    </ChipPopover>
  );
}

function GradientChipEditor({ open, onClose }: ChipEditorProps) {
  const translate = useTranslate();
  const live = useLiveWrite(open.view);
  const [gradient, setGradient] = useState<Gradient>(
    () => parseGradient(open.chip.value) ?? parseGradient(blankLayer('linear').image) ?? blankGradientOf('linear'),
  );
  const change = (next: Gradient): void => {
    setGradient(next);
    live.write(serializeGradient(next));
  };
  return (
    <ChipPopover
      open={open}
      widthPx={CHIP_POPOVER_WIDTH_PX}
      label={translate('style.backgroundLayerEditor.gradient')}
      onClose={() => {
        live.flush();
        onClose();
      }}
    >
      <div className="embed-editor_bg-editor">
        <GradientTypeRow type={gradient.type} onChange={(type) => change({ ...gradient, type })} />
        <GradientEditor gradient={gradient} busy={false} onChange={change} />
      </div>
    </ChipPopover>
  );
}

function GradientTypeRow({ type, onChange }: { readonly type: GradientType; readonly onChange: (type: GradientType) => void }) {
  const translate = useTranslate();
  const options = typeOptions(translate).filter((option) => isGradientType(option.value));
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.backgroundLayerEditor.type')}</span>
      <SegmentedControl<LayerKind>
        options={options}
        value={type}
        onChange={(next) => {
          if (isGradientType(next)) {
            onChange(next);
          }
        }}
        ariaLabel={translate('style.backgroundLayerEditor.layerType')}
      />
    </div>
  );
}

const CheckGlyph = centralIcon(centralCheck);

function KeywordChipEditor({ open, property, onClose }: ChipEditorProps & { readonly property: KeywordPropertyName }) {
  const translate = useTranslate();
  const [value, setValue] = useState(open.chip.value);
  const current = value.trim().toLowerCase();
  const preview = useChipPreview({ property, valueWith: (keyword) => keyword }, { exits: 'leave' });
  const hover = usePickerHoverPreview({ onPreview: preview.onPreview, previewEpoch: preview.previewEpoch, onPreviewEnd: preview.onPreviewEnd });
  const pick = (next: string): void => {
    preview.handOver(next);
    writeChipValue(open.view, next);
    onClose();
  };
  if (keywordControlOf(property) !== 'list') {
    const commit = (next: string): void => {
      setValue(next);
      writeChipValue(open.view, next);
      if (isKeywordOf(property, next) || /^var\(/i.test(next)) {
        onClose();
      }
    };
    return (
      <ChipPopover open={open} widthPx={CHIP_POPOVER_WIDTH_PX} label={property} onClose={onClose}>
        <div className="code-chip-keywords">
          <KeywordChipControl property={property} value={value} onCommit={commit} />
        </div>
      </ChipPopover>
    );
  }
  const { segments, list: rest } = keywordChoices(property, translate);
  const list = [...segments, ...rest];
  return (
    <ChipPopover open={open} widthPx={CHIP_POPOVER_WIDTH_PX} label={property} onClose={onClose}>
      <div className="code-chip-keywords">
        {list.length > 0 ? (
          <div className="code-chip-keyword-list" role="listbox" aria-label={property} onPointerLeave={() => hover.end({ when: 'now' })}>
            {list.map((option) => {
              const selected = option.value.toLowerCase() === current;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="menu-row"
                  onPointerEnter={() => hover.enter(option.value)}
                  onFocus={() => hover.enter(option.value)}
                  onBlur={() => hover.end({ when: 'now' })}
                  onClick={() => pick(option.value)}
                >
                  {option.icon === undefined ? undefined : <span className="menu-icon">{option.icon}</span>}
                  <span className="menu-label">{option.text}</span>
                  {selected ? (
                    <span className="menu-end">
                      <span className="menu-check">
                        <CheckGlyph />
                      </span>
                    </span>
                  ) : undefined}
                </button>
              );
            })}
          </div>
        ) : undefined}
      </div>
    </ChipPopover>
  );
}

function ColorChipEditor({ open, onClose }: ChipEditorProps) {
  const live = useLiveWrite(open.view);
  const [value, setValue] = useState(open.chip.value);
  return (
    <ColorPicker
      value={value}
      anchor={open.anchorRect}
      onChange={(color, dragging) => {
        setValue(color);
        live.write(color);
        if (!dragging) {
          live.flush();
        }
      }}
      onClose={() => {
        live.flush();
        onClose();
      }}
    />
  );
}

function LayersChipEditor({ open, property, onClose }: ChipEditorProps & { readonly property: LayeredProperty }) {
  const translate = useTranslate();
  const live = useLiveWrite(open.view);
  const [original] = useState(open.chip.value);
  const [value, setValue] = useState(original);
  const put = (next: string, phase: 'live' | 'commit'): void => {
    setValue(next);
    live.write(next);
    if (phase === 'commit') {
      live.flush();
    }
  };
  const props = chipDeclarationProps({ property, value, original }, put);
  return (
    <ChipPopover
      open={open}
      widthPx={CHIP_POPOVER_WIDTH_PX}
      label={layersTitle(property, translate)}
      onClose={() => {
        live.flush();
        onClose();
      }}
    >
      {}
      <LayerListOpensSingleRow.Provider value={true}>
        <LayersRow property={property} props={props} />
      </LayerListOpensSingleRow.Provider>
    </ChipPopover>
  );
}

function LayersRow({ property, props }: { readonly property: LayeredProperty; readonly props: StyleRowProps }) {
  const translate = useTranslate();
  switch (property) {
    case 'transition':
      return <TransitionsRow props={props} />;
    case 'transform':
      return <TransformsRow props={props} />;
    case 'filter':
      return <FiltersRow prop="filter" label={translate('style.effectsSection.filters')} props={props} />;
    case 'backdrop-filter':
      return <FiltersRow prop="backdrop-filter" label={translate('style.effectsSection.backdropFilters')} props={props} />;
    case 'box-shadow':
      return <BoxShadowsRow props={props} />;
    case 'text-shadow':
      return <TextShadowsRow {...props} />;
    case 'background-image':
      return <BackgroundLayersList props={props} />;
    default: {
      const exhaustive: never = property;
      throw new Error(`Assertion failed: LayersRow: no list for ${String(exhaustive)}`);
    }
  }
}

function layersTitle(property: LayeredProperty, translate: ReturnType<typeof useTranslate>): string {
  switch (property) {
    case 'transition':
      return translate('style.transitionsRow.transitions');
    case 'transform':
      return translate('style.transformsRow.transforms2d3d');
    case 'filter':
      return translate('style.effectsSection.filters');
    case 'backdrop-filter':
      return translate('style.effectsSection.backdropFilters');
    case 'box-shadow':
      return translate('style.boxShadowsRow.boxShadows');
    case 'text-shadow':
      return translate('style.textStrokeShadow.textShadows');
    case 'background-image':
      return translate('style.backgroundSection.imageAndGradient');
    default: {
      const exhaustive: never = property;
      return exhaustive;
    }
  }
}

function BackgroundLayersList({ props }: { readonly props: StyleRowProps }) {
  const translate = useTranslate();
  const value = displayOf(props.read('background-image')).value;
  const layers = parseLayers({ image: value, size: '', position: '', repeat: '', attachment: '', origin: '', clip: '' });
  const [openLayer, setOpenLayer] = useState<number | undefined>(undefined);
  const applyLayers = (next: BgLayer[]): void => {
    const image = serializeLayers(next).image;
    if (image.length > 0) {
      props.setProp('background-image', image, false);
    } else {
      props.clearProp('background-image');
    }
  };
  const add = (): void => {
    applyLayers([blankLayer('image'), ...layers]);
    setOpenLayer(0);
  };
  const remove = (index: number): void => {
    applyLayers(layers.filter((_, other) => other !== index));
    setOpenLayer((current) => openAfterRemoval(current, index));
  };
  const reorder = (from: number, to: number): void => {
    const next = [...layers];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(to, 0, moved);
    applyLayers(next);
    setOpenLayer((current) => (current === from ? to : current));
  };
  return (
    <div className="embed-editor_type-shadows">
      <div className="embed-editor_bg-layers-head">
        <EffLabel label={translate('style.backgroundSection.imageAndGradient')} prop="background-image" props={props} />
        <button
          type="button"
          className="embed-editor_icon-btn"
          onClick={add}
          title={translate('style.backgroundSection.addLayer')}
          aria-label={translate('style.backgroundSection.addBackgroundLayer')}
        >
          <PlusIcon />
        </button>
      </div>
      <LayerList
        count={layers.length}
        busy={false}
        ariaLabel={translate('style.backgroundSection.backgroundLayers')}
        onOpen={(index) => setOpenLayer((current) => (current === index ? undefined : index))}
        onReorder={reorder}
        onRemove={remove}
        renderRow={(index) => layerRow(layers, index, translate)}
      />
      {openLayer !== undefined && layers[openLayer] !== undefined ? (
        <LayerEditor
          layers={layers}
          index={openLayer}
          busy={false}
          setProp={props.setProp}
          clearProp={props.clearProp}
          liveSetProp={props.liveSetProp}
          applyLayers={applyLayers}
        />
      ) : undefined}
    </div>
  );
}

export function chipDeclarationProps(
  declaration: { readonly property: LayeredProperty; readonly value: string; readonly original: string },
  put: (value: string, phase: 'live' | 'commit') => void,
): StyleRowProps {
  const { property, value, original } = declaration;
  const resolved = declarationResolved(property, value);
  const accept = (prop: string, next: string | undefined, phase: 'live' | 'commit'): void => {
    if (prop !== property) {
      return;
    }
    const text = (next ?? original).trim();
    if (text.length > 0) {
      put(text, phase);
    }
  };
  return {
    read: (prop) => (prop === property ? resolved : undefined),
    busy: false,
    setProp: (prop, next) => accept(prop, next, 'commit'),
    liveSetProp: (prop, next) => accept(prop, next, 'live'),
    clearProp: (prop) => {
      const props = typeof prop === 'string' ? [prop] : prop;
      if (props.includes(property)) {
        put('none', 'commit');
      }
    },
    onProvenance: () => undefined,
    onSelectSelector: () => undefined,
  };
}

function declarationResolved(property: string, value: string): ResolvedProp {
  const winner = {
    selectorText: '',
    value,
    important: false,
    specificity: [0, 0, 0] as const,
    order: 0,
    ruleId: 'code-chip',
    origin: 'embed' as const,
    isSelected: true,
    winning: true,
    complexOnly: false,
  };
  return {
    prop: property,
    source: 'selected',
    selectedOrigin: 'embed',
    selectedValue: { value, important: false },
    winner,
    overridden: false,
    contributors: [],
  };
}
