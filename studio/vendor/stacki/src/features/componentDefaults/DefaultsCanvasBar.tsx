import { useTranslate } from '../../lib/i18n/useTranslate';
import { ErrorToast } from '../../ui/ErrorToast';
import type { useDefaultsCanvas } from './useDefaultsCanvas';
import './componentDefaults.css';

export function DefaultsCanvasBar({ canvas }: { readonly canvas: ReturnType<typeof useDefaultsCanvas> }) {
  const translate = useTranslate();
  const state = canvas.state;
  if (state.kind === 'idle' || (!state.message && canvas.isOpen)) {
    return undefined;
  }
  return (
    <ErrorToast
      message={state.message}
      recovery={[
        ...(!canvas.isOpen ? [{ label: translate('componentProps.defaults.return'), run: () => canvas.run('resume') }] : []),
        ...(state.kind !== 'saving' ? [{ label: translate('componentProps.defaults.discard'), run: () => canvas.run('discard') }] : []),
      ]}
    />
  );
}
