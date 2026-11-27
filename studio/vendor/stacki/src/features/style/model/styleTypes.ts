
import type { Root, Rule, Declaration as PostcssDeclaration } from 'postcss';
import type { LayerPosition } from './cascadeLayers';

export type StyleRegion = {
  start: number;
  end: number;
  css: string;
  root: Root | undefined;
  parseError?: string | undefined;
  openTag?: string;
};

export type Specificity = readonly [number, number, number];

export type SelectorInfo = {
  text: string;
  specificity: Specificity;
  hasPseudoClass: boolean;
  pseudoElement: string | undefined;
  approximate: boolean;
};

export type ParsedRule = {
  ruleId: string;
  order: number;
  embedKey: string;
  embedLabel: string;
  fromComponent: boolean;
  componentName: string | undefined;
  regionIndex: number;
  node: Rule;
  selectorText: string;
  nestedDisplay?: string;
  queryDisplay?: string;
  atContext: string[];
  written?: { readonly parents: readonly string[]; readonly head: string };
  selectors: SelectorInfo[];
  declarations: ParsedDeclaration[];
  layer?: LayerPosition;
};

export type ParsedDeclaration = {
  declId: string;
  prop: string;
  value: string;
  important: boolean;
  node: PostcssDeclaration;
};


export type BreakpointId = 'xxl' | 'xl' | 'large' | 'main' | 'medium' | 'small' | 'tiny';

export type NativeProp = {
  value: string;
  isVariable: boolean;
};

export type NativeStyle = {
  styleId: string;
  displayName: string;
  className: string;
  index: number;
  isCombo: boolean;
  applied: boolean;
  namePath: string[];
  propsByContext: Map<string, Map<string, NativeProp>>;
  style: unknown;
};

export type NativeModel = {
  styles: NativeStyle[];
  read: boolean;
};

export type ElementSnapshot = {
  tag: string | undefined;
  webflowType: string;
  id: string | undefined;
  classes: string[];
  classList: string[];
  attributes: Record<string, string>;
};
