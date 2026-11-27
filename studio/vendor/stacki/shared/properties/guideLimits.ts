export const GUIDE_LIMITS = {
  columnPickMax: 32,
  columnPickMin: 2,
  colorCharsMax: 64,
  lengthPxMax: 100_000,
  lengthRemMax: 6_000,
  opacityMax: 0.2,
  opacityMin: 0.06,
  opacityStep: 0.01,
  rootFontPxMax: 1_000,
  variableCharsMax: 64,
  variablesMax: 5,
} as const satisfies Record<string, number>;
