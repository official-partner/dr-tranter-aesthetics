import type { Box } from './outlineBoxes';
type Side = 'top' | 'right' | 'bottom' | 'left';
interface SpacingSides {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}
export type CollapsePartner = 'previous' | 'next' | 'parent';

export interface MarginCollapse {
  readonly partner: CollapsePartner;
  readonly margin: number;
}

export interface Spacing {
  readonly padding?: SpacingSides;
  readonly margin?: SpacingSides;
  readonly collapse?: { readonly top?: MarginCollapse; readonly bottom?: MarginCollapse };
  readonly gaps?: readonly (Box & { readonly axis: 'row' | 'column' })[];
  readonly units?: Readonly<Record<string, number>>;
}
export interface Band extends Box {
  readonly side: string;
  readonly collapsedInto?: CollapsePartner;
}

export const COLLAPSE_MARKER_PX = 2;

export function marginContribution(own: number, adjoining: number | undefined): number {
  if (adjoining === undefined) {
    return own;
  }
  if (own > 0 && adjoining > 0) {
    return Math.max(0, own - adjoining);
  }
  return own;
}


const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function spacingBands(
  box: Box | undefined,
  spacing: Spacing | undefined,
  kind: 'padding' | 'margin' | 'gap',
  sides?: readonly string[] | undefined,
): readonly Band[] {
  if (kind === 'gap') {
    const want = new Set(sides || ['row', 'column']);
    return (spacing?.gaps || [])
      .filter((band) => want.has(band.axis) && band.w > 0 && band.h > 0)
      .map((band) => ({ side: band.axis, x: band.x, y: band.y, w: band.w, h: band.h }));
  }
  if (!box || !spacing?.[kind]) {
    return [];
  }
  const size = spacing[kind];
  const want = new Set(sides || []);
  const at = (side: Side) => Math.max(0, Number(size[side]) || 0);
  const top = at('top');
  const bottom = at('bottom');
  const left = at('left');
  const right = at('right');

  const outer = kind === 'margin' ? { x: box.x - left, y: box.y - top, w: box.w + left + right, h: box.h + top + bottom } : box;

  const cutLeft = want.has('left') && left > 0 ? left : 0;
  const cutRight = want.has('right') && right > 0 ? right : 0;

  const bands = {
    top: { x: outer.x + cutLeft, y: outer.y, w: outer.w - cutLeft - cutRight, h: top },
    bottom: {
      x: outer.x + cutLeft,
      y: kind === 'margin' ? box.y + box.h : box.y + box.h - bottom,
      w: outer.w - cutLeft - cutRight,
      h: bottom,
    },
    left: { x: outer.x, y: outer.y, w: left, h: outer.h },
    right: {
      x: kind === 'margin' ? box.x + box.w : box.x + box.w - right,
      y: outer.y,
      w: right,
      h: outer.h,
    },
  };

  const drawn = SIDES.filter((side) => want.has(side) && bands[side].w > 0 && bands[side].h > 0).map((side): Band => ({ side, ...bands[side] }));
  return kind === 'margin' ? drawn.map((band) => collapsedMarker(band, box, spacing.collapse)) : drawn;
}

function collapsedMarker(band: Band, box: Box, collapse: Spacing['collapse']): Band {
  if (band.side !== 'top' && band.side !== 'bottom') {
    return band;
  }
  const partner = collapse?.[band.side];
  if (!partner) {
    return band;
  }
  if (marginContribution(band.h, partner.margin) > 0) {
    return band;
  }
  const y = band.side === 'top' ? box.y - COLLAPSE_MARKER_PX : box.y + box.h;
  return { ...band, y, h: COLLAPSE_MARKER_PX, collapsedInto: partner.partner };
}

export function clipBand(band: Band, viewport: { readonly w: number; readonly h: number } | undefined): Band | undefined {
  if (!viewport) {
    return band;
  }
  const left = Math.max(0, band.x);
  const top = Math.max(0, band.y);
  const right = Math.min(viewport.w, band.x + band.w);
  const bottom = Math.min(viewport.h, band.y + band.h);
  if (right <= left || bottom <= top) {
    return undefined;
  }
  return { ...band, x: left, y: top, w: right - left, h: bottom - top };
}

const LENGTH = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|rem|em|vw|vh)?\s*(?:!important)?\s*$/i;

export function lengthToPx(value: string, units: Readonly<Record<string, number>> | undefined): number | undefined {
  const match = LENGTH.exec(value);
  if (!match) {
    return undefined;
  }
  const amount = parseFloat(match[1] ?? '');
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '') {
    return amount === 0 ? 0 : undefined;
  }
  if (unit === 'px') {
    return amount;
  }
  const perUnit = units?.[unit];
  if (perUnit === undefined) {
    return undefined;
  }
  return perUnit > 0 ? amount * perUnit : undefined;
}

export function withLiveSpacing(spacing: Spacing | undefined, kind: string, live: Readonly<Record<string, string>> | undefined): Spacing | undefined {
  if (!spacing || !live) {
    return spacing;
  }
  if (kind !== 'padding' && kind !== 'margin') {
    return spacing;
  }
  const sizes: { [Key in Side]?: number } = { ...spacing[kind] };
  let changed = false;
  for (const side of SIDES) {
    const value = live[side];
    const px = value === undefined ? undefined : lengthToPx(value, spacing.units);
    if (px !== undefined) {
      sizes[side] = px;
      changed = true;
    }
  }
  return changed ? { ...spacing, [kind]: sizes } : spacing;
}

export default spacingBands;
