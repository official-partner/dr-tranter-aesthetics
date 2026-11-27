import { Compartment, Facet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert } from '../../../../shared/core/assert';
import type { Translator } from '../../../lib/i18n/localeContext';
import { MiniCurve } from '../EasingEditor';
import { ClipGlyph, clipPathType } from '../ClipPathRow';
import { tokenChipHtml } from '../TokenField';
import { ClockIcon } from '../TransitionsRow';
import { FilterGlyph } from '../TransformsRow';
import { transformTypeIcon } from '../transformIcons';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { add as centralAdd, layers as centralLayers, listMenu as centralListMenu } from '../../../ui/central/centralGeometry';
import { keywordOption, type KeywordPropertyName } from './keywordOptions';
import { referenceChip } from '../VariableConnect';
import { BOX_SHADOW_PREVIEW_CHECKERBOARD } from '../BoxShadowsRow';
import { parseBoxShadows } from '../model/boxShadow';
import { parseShadows } from '../model/textShadow';
import { easingToBezier } from '../model/transition';
import { rootColorNow } from '../model/computedColor';
import type { ProjectVariable } from '../model/webflow';
import { currentCodeChipsMode, subscribeCodeChipsMode } from './codeChipsPreference';
import { variableChipShown, variableNames } from './chipTyping';
import { cssValueChips, type CssChipRange, type CssChipText, type CssValueChip, type LayeredProperty } from './cssValueChips';
import './codeChips.css';


export interface CodeChipHandlers {
  readonly text: () => CssChipText | undefined;
  readonly variables: () => readonly ProjectVariable[];
  readonly translate: () => Translator;
  readonly onOpen: (request: CodeChipRequest) => void;
  readonly onView: (view: EditorView, presence: 'mounted' | 'gone') => void;
}

export interface CodeChipRequest {
  readonly view: EditorView;
  readonly chip: CssValueChip;
  readonly anchor: DOMRect;
}

type HandlersRef = { readonly current: CodeChipHandlers };

export const refreshCodeChips = StateEffect.define<'refresh'>();
const openChipEffect = StateEffect.define<CssChipRange | undefined>();

const openChipField = StateField.define<CssChipRange | undefined>({
  create: () => undefined,
  update: (range, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(openChipEffect)) {
        return effect.value;
      }
    }
    if (range === undefined) {
      return range;
    }
    if (!transaction.docChanged) {
      return range;
    }
    if (range.from === range.to) {
      const at = transaction.changes.mapPos(range.from, -1);
      return { from: at, to: at };
    }
    const from = transaction.changes.mapPos(range.from, 1);
    const to = transaction.changes.mapPos(range.to, -1);
    return from < to ? { from, to } : undefined;
  },
});

export function codeChipsExtension(handlersRef: HandlersRef): Extension {
  const compartment = new Compartment();
  const chips = chipLayer(handlersRef);
  const shown = (): Extension => (currentCodeChipsMode() === 'shown' ? chips : []);
  const follower = ViewPlugin.define((view) => {
    const unsubscribe = subscribeCodeChipsMode(() => view.dispatch({ effects: compartment.reconfigure(shown()) }));
    handlersRef.current.onView(view, 'mounted');
    return {
      destroy: () => {
        unsubscribe();
        handlersRef.current.onView(view, 'gone');
      },
    };
  });
  return [openChipField, compartment.of(shown()), follower];
}

export function openChipRange(view: EditorView): CssChipRange | undefined {
  return view.state.field(openChipField, false);
}

export function setOpenChip(view: EditorView, range: CssChipRange | undefined): void {
  if (range !== undefined) {
    assert(range.from <= range.to, 'setOpenChip: an open chip keeps its order');
    assert(range.to <= view.state.doc.length, 'setOpenChip: an open chip lies in the document');
  }
  view.dispatch({ effects: openChipEffect.of(range) });
}

export function writeChipValue(view: EditorView, value: string): boolean {
  assert(value.length > 0, 'writeChipValue: a chip value is never empty');
  const range = openChipRange(view);
  if (range === undefined) {
    return false;
  }
  assert(range.to <= view.state.doc.length, 'writeChipValue: the open chip lies in the document');
  if (view.state.sliceDoc(range.from, range.to) === value) {
    return false;
  }
  const { before, after } = range.from === range.to ? createdValueFrame(view.state.doc.toString(), range.from) : { before: '', after: '' };
  const from = range.from + before.length;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `${before}${value}${after}` },
    effects: openChipEffect.of({ from, to: from + value.length }),
    userEvent: 'input.chip',
  });
  const written = openChipRange(view);
  assert(written !== undefined, 'writeChipValue: the written value stays open');
  assert(view.state.sliceDoc(written.from, written.to) === value, 'writeChipValue: the open range is the written value');
  return true;
}

export function createdValueFrame(text: string, at: number): { readonly before: string; readonly after: string } {
  assert(at >= 0, 'createdValueFrame: the place is in the text');
  assert(at <= text.length, 'createdValueFrame: the place ends in the text');
  const before = text.charAt(at - 1) === ':' ? ' ' : '';
  let index = at;
  while (index < text.length && (text.charAt(index) === ' ' || text.charAt(index) === '\t')) {
    index += 1;
  }
  if (text.charAt(index) === ';') {
    return { before, after: '' };
  }
  if (/^!\s*important/i.test(text.slice(index, index + 16))) {
    return { before, after: index === at ? ' ' : '' };
  }
  return { before, after: ';' };
}

export function drawnCodeChips(view: EditorView): readonly CssValueChip[] {
  const plugin = view.state.facet(chipPluginFacet);
  if (plugin === undefined) {
    return [];
  }
  return view.plugin(plugin)?.drawing.chips ?? [];
}


interface ChipDrawing {
  readonly chips: readonly CssValueChip[];
  readonly found: readonly CssValueChip[];
  readonly editing: number | undefined;
  readonly decorations: DecorationSet;
  readonly atomic: DecorationSet;
}

const VIEWPORT_MARGIN_CHARS = 2_000;

interface ChipLayerValue extends PluginValue {
  readonly drawing: ChipDrawing;
}

const chipPluginFacet = Facet.define<ViewPlugin<ChipLayerValue>, ViewPlugin<ChipLayerValue> | undefined>({ combine: (plugins) => plugins[0] });

function chipLayer(handlersRef: HandlersRef): Extension {
  const scan = (view: EditorView): readonly CssValueChip[] => {
    const kind = handlersRef.current.text();
    return kind === undefined ? [] : cssValueChips(view.state.doc.toString(), kind);
  };
  let names: { readonly from: readonly ProjectVariable[]; readonly names: ReadonlySet<string> } | undefined = undefined;
  const namesOf = (variables: readonly ProjectVariable[]): ReadonlySet<string> => {
    if (names === undefined || names.from !== variables) {
      names = { from: variables, names: variableNames(variables) };
    }
    return names.names;
  };
  const draw = (view: EditorView, found: readonly CssValueChip[]): ChipDrawing => {
    const handlers = handlersRef.current;
    const variables = handlers.variables();
    const caret = view.hasFocus ? view.state.selection.main.head : undefined;
    const known = namesOf(variables);
    const chips = found.filter((chip) => chip.kind !== 'variable' || variableChipShown(chip, known, caret));
    assert(chips.length <= found.length, 'chipLayer: the drawn chips are among the found ones');
    const seen = chipsInViewport(chips, view.viewport, view.state.doc.length);
    return { ...chipDecorations(seen, { handlersRef, variables, translate: handlers.translate() }), chips, found, editing: editedReference(found, caret) };
  };
  const plugin = ViewPlugin.fromClass(
    class ChipLayer implements ChipLayerValue {
      drawing: ChipDrawing;
      constructor(view: EditorView) {
        this.drawing = draw(view, scan(view));
      }
      update(update: ViewUpdate): void {
        const asked = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshCodeChips)));
        if (update.docChanged || asked) {
          this.drawing = draw(update.view, scan(update.view));
        } else if (update.viewportChanged) {
          this.drawing = draw(update.view, this.drawing.found);
        } else if (update.selectionSet || update.focusChanged) {
          const caret = update.view.hasFocus ? update.state.selection.main.head : undefined;
          if (editedReference(this.drawing.found, caret) !== this.drawing.editing) {
            this.drawing = draw(update.view, this.drawing.found);
          }
        }
      }
    },
    { decorations: (layer) => layer.drawing.decorations },
  );
  const atomic = EditorView.atomicRanges.of((view) => view.plugin(plugin)?.drawing.atomic ?? Decoration.none);
  return [plugin, atomic, chipPluginFacet.of(plugin)];
}

function editedReference(found: readonly CssValueChip[], caret: number | undefined): number | undefined {
  if (caret === undefined) {
    return undefined;
  }
  return found.find((chip) => chip.kind === 'variable' && chip.from < caret && caret < chip.to)?.from;
}

interface DrawContext {
  readonly handlersRef: HandlersRef;
  readonly variables: readonly ProjectVariable[];
  readonly translate: Translator;
}

export function chipsInViewport(chips: readonly CssValueChip[], viewport: CssChipRange, documentLength: number): readonly CssValueChip[] {
  assert(viewport.from <= viewport.to, 'chipsInViewport: the viewport keeps its order');
  assert(viewport.to <= documentLength, 'chipsInViewport: the viewport lies in the document');
  const from = Math.max(0, viewport.from - VIEWPORT_MARGIN_CHARS);
  const to = Math.min(documentLength, viewport.to + VIEWPORT_MARGIN_CHARS);
  return chips.filter((chip) => chip.to >= from && chip.from <= to);
}

function chipDecorations(chips: readonly CssValueChip[], context: DrawContext): Pick<ChipDrawing, 'decorations' | 'atomic'> {
  const all: Array<Range<Decoration>> = [];
  const atomic: Array<Range<Decoration>> = [];
  for (const chip of chips) {
    assert(chip.from <= chip.to, 'chipDecorations: a chip keeps its order');
    const widget = new ChipWidget(chip, chipFace(chip, context), context.handlersRef);
    if (chip.kind === 'variable') {
      const replaced = Decoration.replace({ widget }).range(chip.from, chip.to);
      all.push(replaced);
      atomic.push(replaced);
    } else {
      all.push(Decoration.widget({ widget, side: -1 }).range(chip.from));
    }
  }
  assert(atomic.length <= all.length, 'chipDecorations: every atomic chip is drawn');
  return { decorations: Decoration.set(all, true), atomic: Decoration.set(atomic, true) };
}


interface ChipFace {
  readonly key: string;
  readonly label: string;
  readonly build: () => HTMLElement;
}

const GLYPHS_CACHED_MAX = 256;
const glyphCache = new Map<string, string>();
function glyphMarkup(key: string, render: () => string): string {
  const cached = glyphCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const markup = render();
  if (glyphCache.size >= GLYPHS_CACHED_MAX) {
    glyphCache.clear();
  }
  glyphCache.set(key, markup);
  return markup;
}

const AddGlyph = centralIcon(centralAdd);
const LayersGlyph = centralIcon(centralLayers);
const KeywordGlyph = centralIcon(centralListMenu);
function iconMarkup(key: string, icon: ComponentType): string {
  return glyphMarkup(key, () => renderToStaticMarkup(createElement(icon)));
}

function chipFace(chip: CssValueChip, context: DrawContext): ChipFace {
  const { translate } = context;
  if (chip.kind !== 'variable' && chip.value === '') {
    const label = chipLabel(chip, translate);
    return { key: `create|${chip.kind}|${label}`, label, build: () => iconChip('is-create', iconMarkup('icon|add', AddGlyph)) };
  }
  switch (chip.kind) {
    case 'variable': {
      const token = referenceChip(chip.value, [...context.variables]);
      const markup = tokenChipHtml(token);
      return {
        key: `variable|${markup}`,
        label: translate('styleModel.shared.connectVariable', { label: chip.property ?? token.name }),
        build: () => elementFrom(markup),
      };
    }
    case 'easing': {
      const markup = glyphMarkup(`ease|${chip.value}`, () => renderToStaticMarkup(createElement(MiniCurve, { b: easingToBezier(chip.value) })));
      return { key: `easing|${chip.value}`, label: translate('style.easingEditor.easingEditor'), build: () => iconChip('is-ease', markup) };
    }
    case 'clipPath': {
      const type = clipPathType(chip.value);
      const markup = glyphMarkup(`clip|${type}`, () => renderToStaticMarkup(createElement(ClipGlyph, { type })));
      return { key: `clip|${type}`, label: translate('style.clipPathRow.clipPath'), build: () => iconChip('is-clip', markup) };
    }
    case 'boxShadow': {
      const color = parseBoxShadows(chip.value)[0]?.color ?? '';
      return { key: `box|${color}`, label: translate('style.boxShadowsRow.boxShadow'), build: () => swatchChip(`linear-gradient(${color}, ${color})`) };
    }
    case 'textShadow': {
      const color = parseShadows(chip.value)[0]?.color ?? '';
      return { key: `text|${color}`, label: translate('style.textStrokeShadow.textShadow'), build: () => swatchChip(`linear-gradient(${color}, ${color})`) };
    }
    case 'gradient':
      return { key: `gradient|${chip.value}`, label: translate('style.backgroundLayerEditor.gradient'), build: () => swatchChip(chip.value) };
    case 'color': {
      const paint = chip.variable === undefined ? chip.value : (rootColorNow(`var(${chip.variable})`) ?? chip.value);
      return { key: `color|${paint}`, label: chipLabel(chip, translate), build: () => swatchChip(`linear-gradient(${paint}, ${paint})`) };
    }
    case 'layers': {
      const label = chipLabel(chip, translate);
      return { key: `layers|${chip.property}|${label}`, label, build: () => iconChip('is-layers', layersMarkup(chip.property)) };
    }
    case 'keyword': {
      const label = chipLabel(chip, translate);
      const markup = keywordMarkup(chip.property, chip.value, translate);
      return { key: `keyword|${markup}|${label}`, label, build: () => iconChip('is-keyword', markup) };
    }
    default: {
      const exhaustive: never = chip;
      throw new Error(`Assertion failed: code chips: unknown chip ${JSON.stringify(exhaustive)}`);
    }
  }
}

function keywordMarkup(property: KeywordPropertyName, value: string, translate: Translator): string {
  const icon = keywordOption(property, value, translate)?.icon;
  if (icon === undefined || icon === null) {
    return iconMarkup('icon|keyword', KeywordGlyph);
  }
  return glyphMarkup(`keyword|${property}|${value.toLowerCase()}`, () => renderToStaticMarkup(createElement('span', { className: 'code-chip-glyph' }, icon)));
}

function layersMarkup(property: LayeredProperty): string {
  switch (property) {
    case 'transition':
      return iconMarkup('icon|clock', ClockIcon);
    case 'transform':
      return glyphMarkup('icon|transform', () => renderToStaticMarkup(createElement('span', { className: 'code-chip-glyph' }, transformTypeIcon('move'))));
    case 'filter':
    case 'backdrop-filter':
      return iconMarkup('icon|filter', FilterGlyph);
    case 'box-shadow':
    case 'text-shadow':
    case 'background-image':
      return iconMarkup('icon|layers', LayersGlyph);
    default: {
      const exhaustive: never = property;
      throw new Error(`Assertion failed: code chips: unknown property ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function chipLabel(chip: Exclude<CssValueChip, { kind: 'variable' }>, translate: Translator): string {
  switch (chip.kind) {
    case 'easing':
      return translate('style.easingEditor.easingEditor');
    case 'clipPath':
      return translate('style.clipPathRow.clipPath');
    case 'boxShadow':
      return translate('style.boxShadowsRow.boxShadow');
    case 'textShadow':
      return translate('style.textStrokeShadow.textShadow');
    case 'gradient':
      return translate('style.backgroundLayerEditor.gradient');
    case 'color':
      return translate('style.effectsSection.color');
    case 'layers':
      return layersLabel(chip.property, translate);
    case 'keyword':
      return chip.property;
    default: {
      const exhaustive: never = chip;
      throw new Error(`Assertion failed: code chips: unknown chip ${JSON.stringify(exhaustive)}`);
    }
  }
}

function layersLabel(property: LayeredProperty, translate: Translator): string {
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
      throw new Error(`Assertion failed: code chips: unknown property ${JSON.stringify(exhaustive)}`);
    }
  }
}

function elementFrom(markup: string): HTMLElement {
  const holder = document.createElement('span');
  holder.innerHTML = markup;
  const element = holder.firstElementChild;
  assert(element instanceof HTMLElement, 'elementFrom: the chip markup is one element');
  return element;
}

function iconChip(modifier: string, glyph: string): HTMLElement {
  const element = document.createElement('span');
  element.className = `code-chip ${modifier}`;
  element.innerHTML = glyph;
  return element;
}

function swatchChip(paint: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'code-chip is-swatch';
  const swatch = document.createElement('span');
  swatch.className = 'code-chip-swatch';
  swatch.style.background = `${paint}, ${BOX_SHADOW_PREVIEW_CHECKERBOARD}`;
  element.append(swatch);
  return element;
}

class ChipWidget extends WidgetType {
  constructor(
    private readonly chip: CssValueChip,
    private readonly face: ChipFace,
    private readonly handlersRef: HandlersRef,
  ) {
    super();
  }
  override eq(other: ChipWidget): boolean {
    return other.face.key === this.face.key && other.face.label === this.face.label;
  }
  override toDOM(view: EditorView): HTMLElement {
    const element = this.face.build();
    element.dataset['codeChip'] = this.chip.kind;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', this.face.label);
    if (!element.hasAttribute('title')) {
      element.title = this.face.label;
    }
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.press(view, element);
    });
    return element;
  }
  private press(view: EditorView, element: HTMLElement): void {
    const from = view.posAtDOM(element);
    const chip = drawnCodeChips(view).find((candidate) => candidate.from === from && candidate.kind === this.chip.kind);
    if (chip === undefined) {
      return;
    }
    this.handlersRef.current.onOpen({ view, chip, anchor: element.getBoundingClientRect() });
  }
  override ignoreEvent(): boolean {
    return true;
  }
}
