
import type { StateKey } from './resolved';
import type { TypedMessageRef } from '../../../../shared/properties/i18n/messageRef';
import { failureOf } from './failureMessage';
import type { NativeModel } from './styleTypes';
import type { NativeStyleOptions } from './nativeStyles';
import { type AnyElement } from './webflowElement';


export function nativeStylingAvailable(): boolean {
  return false;
}

export const EMPTY_NATIVE: NativeModel = { styles: [], read: false };

export type NativeWriteTarget = { namePath: string[]; index: number | undefined };

export async function readNativeStyles(_element: AnyElement, _states: readonly StateKey[], onPhase?: (model: NativeModel) => void): Promise<NativeModel> {
  onPhase?.(EMPTY_NATIVE);
  return EMPTY_NATIVE;
}

export async function readNativeStyleByName(_className: string, _states: readonly StateKey[]): Promise<NativeModel> {
  return EMPTY_NATIVE;
}

export const NO_NATIVE: {
  readonly ok: false;
  readonly applied: false;
  readonly error: string;
  readonly errorRef: TypedMessageRef;
} = {
  ...failureOf('styleModel.native.cssProject'),
  applied: false,
};

export async function applyNativePropertyAt(
  _element: AnyElement,
  _target: NativeWriteTarget,
  _prop: string,
  _value: string,
  _options?: NativeStyleOptions,
): Promise<typeof NO_NATIVE> {
  return NO_NATIVE;
}

export async function removeNativePropertyAt(
  _element: AnyElement,
  _target: NativeWriteTarget,
  _props: readonly string[],
  _options?: NativeStyleOptions,
): Promise<typeof NO_NATIVE> {
  return NO_NATIVE;
}

export async function applyNativeToNewBaseClass(
  _element: AnyElement,
  _className: string,
  _prop: string,
  _value: string,
  _options?: NativeStyleOptions,
): Promise<typeof NO_NATIVE> {
  return NO_NATIVE;
}

export async function liveSetNativeProperty(_handle: unknown, _prop: string, _value: string, _options?: NativeStyleOptions): Promise<typeof NO_NATIVE> {
  return NO_NATIVE;
}
