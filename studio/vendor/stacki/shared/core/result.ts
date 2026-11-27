import type { MessageRef } from './i18n/messageReference';

export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly messageRef?: MessageRef | undefined;
}

export type Result<T, E = AppError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
