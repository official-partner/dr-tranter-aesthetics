
import { createContext, isValidElement, useContext, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode, Ref, RefCallback } from 'react';

export function childValue(children: ReactNode): string {
  return isValidElement<{ value?: unknown }>(children) && typeof children.props.value === 'string' ? children.props.value : '';
}
export function childPlaceholder(children: ReactNode): string {
  const placeholder = isValidElement<{ placeholder?: unknown }>(children) ? children.props.placeholder : undefined;
  return typeof placeholder === 'string' ? placeholder : '';
}

export function bindingName(binding: string): string {
  const inner = (
    binding
      .replace(/^var\(\s*/i, '')
      .replace(/\s*\)\s*$/i, '')
      .split(',')[0] ?? ''
  ).trim();
  const parts = inner.split('--').filter(Boolean);
  return parts[parts.length - 1] ?? inner;
}

export function nativeVariableNames(value: string): string[] {
  const exact = value.trim();
  const withoutResolved = exact.replace(/\s+\([^()]+\)\s*$/, '').trim();
  return withoutResolved && withoutResolved !== exact ? [exact, withoutResolved] : [exact];
}

export function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, value);
}

export type FieldElement = HTMLInputElement | HTMLTextAreaElement;
export type FieldRefValue = Parameters<RefCallback<FieldElement>>[0];
export type ChildFieldProps = {
  readonly ref?: Ref<FieldElement>;
  readonly className?: string;
  readonly value?: unknown;
  readonly placeholder?: unknown;
  readonly onChange?: (event: unknown) => void;
  readonly onFocus?: (event: unknown) => void;
  readonly onBlur?: (event: unknown) => void;
  readonly onMouseEnter?: (event: unknown) => void;
  readonly onMouseLeave?: (event: unknown) => void;
};

export function isFieldRefCallback(value: unknown): value is RefCallback<FieldElement> {
  return typeof value === 'function';
}

export function updateChildRef(child: ReactElement<ChildFieldProps>, element: FieldRefValue): void {
  const childRef: unknown = Object.getOwnPropertyDescriptor(child, 'ref')?.value;
  if (isFieldRefCallback(childRef)) {
    childRef(element);
  } else if (childRef !== undefined && childRef !== null && typeof childRef === 'object') {
    if (!Reflect.set(childRef, 'current', element)) {
      throw new Error('Child field ref could not be updated');
    }
  }
}

export type PreviewProp = (prop: string | readonly string[], value: string | undefined, important: boolean) => void;

export const previewNowhere: PreviewProp = () => undefined;

export const PreviewPropContext = createContext<PreviewProp>(previewNowhere);

export function useHoverPreview(): PreviewProp {
  return useContext(PreviewPropContext);
}

export interface FieldPreview {
  readonly show: (text: string) => void;
  readonly takeBack: () => void;
  readonly handOver: () => void;
}

export function useFieldPreview(prop: string | undefined): FieldPreview {
  const previewProp = useContext(PreviewPropContext);
  const shownRef = useRef<string | undefined>(undefined);
  const latest = useRef({ previewProp, prop });
  latest.current = { previewProp, prop };
  const takeBack = (): void => {
    const shown = shownRef.current;
    if (shown === undefined) {
      return;
    }
    shownRef.current = undefined;
    latest.current.previewProp(shown, undefined, false);
  };
  const takeBackRef = useRef(takeBack);
  takeBackRef.current = takeBack;
  useEffect(() => () => takeBackRef.current(), []);
  return {
    show: (text) => {
      const target = latest.current.prop;
      if (target === undefined) {
        return;
      }
      if (shownRef.current !== undefined && shownRef.current !== target) {
        takeBack();
      }
      shownRef.current = target;
      latest.current.previewProp(target, text, false);
    },
    takeBack,
    handOver: () => {
      shownRef.current = undefined;
    },
  };
}
