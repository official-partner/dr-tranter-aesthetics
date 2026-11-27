import { useCallback } from 'react';
import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';

export function useFailureText(): (failure: { readonly error: string; readonly errorRef?: MessageRef | undefined }, fallback: MessageKey) => string {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  return useCallback(
    (failure, fallback) => (failure.error ? translateDescribed({ message: failure.error, messageRef: failure.errorRef }) : translate(fallback)),
    [translate, translateDescribed],
  );
}
