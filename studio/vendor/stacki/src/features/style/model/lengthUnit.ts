
import { useSyncExternalStore } from 'react';
import { assert } from '../../../../shared/core/assert';
import {
  convertPxLengths,
  formatPxLength,
  lengthUnitName,
  projectDefaultUnit,
  pxPerLengthUnit,
  type LengthUnit,
} from '../../../../shared/properties/lengthUnit';
import { clampNonNegative } from './cssProperties';
import { getHost, onHostChange } from './host';

export function projectLengthUnit(): LengthUnit {
  return getHost().lengthUnit;
}

export function useLengthUnit(): LengthUnit {
  return useSyncExternalStore(onHostChange, projectLengthUnit);
}

export function writtenValue(prop: string, typed: string, lengthUnit: LengthUnit = projectLengthUnit()): string {
  return convertPxLengths(clampNonNegative(prop, typed), lengthUnit);
}

export interface SliderLength {
  readonly position: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (position: number) => string;
  readonly unit: string;
}

export function sliderLength(
  value: { readonly amount: number; readonly unit: string } | undefined,
  defaultUnit: string,
  range: { readonly min: number; readonly max: number },
  lengthUnit: LengthUnit,
): SliderLength {
  assert(range.min <= range.max, 'sliderLength: the range is ordered');
  const unit = value?.unit ?? projectDefaultUnit(defaultUnit, lengthUnit);
  const pxPerUnit = pxPerLengthUnit(unit, lengthUnit);
  if (lengthUnit.kind === 'rem' && pxPerUnit !== undefined) {
    return {
      position: value === undefined ? undefined : value.amount * pxPerUnit,
      min: range.min,
      max: range.max,
      step: 1,
      format: (position) => formatPxLength(position, lengthUnit),
      unit: lengthUnitName(lengthUnit),
    };
  }
  return {
    position: value?.amount,
    min: range.min,
    max: range.max,
    step: 1,
    format: (position) => `${position}${unit}`,
    unit,
  };
}
