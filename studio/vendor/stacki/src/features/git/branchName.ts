
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';

const FORBIDDEN = /[\x00-\x1f\x7f ~^:?*[\\]/g;

export function sanitizeBranchName(text: unknown): string {
  return String(text ?? '')
    .replace(/\s+/g, '-')
    .replace(FORBIDDEN, '')
    .replace(/@\{/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/')
    .replace(/\/\./g, '/')
    .replace(/^[-./]+/, '');
}

export function branchNameError(name: unknown, existing: readonly string[] = [], translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === '@') {
    return translate('git.branch.error.at');
  }
  if (trimmed.endsWith('/')) {
    return translate('git.branch.error.endsSlash');
  }
  if (trimmed.endsWith('.')) {
    return translate('git.branch.error.endsDot');
  }
  if (trimmed.toLowerCase() === 'head') {
    return translate('git.branch.error.head');
  }
  if (trimmed.split('/').some((part) => part.startsWith('.') || part.includes('..'))) {
    return translate('git.branch.error.component');
  }
  if (trimmed.split('/').some((part) => part.endsWith('.lock'))) {
    return translate('git.branch.error.lock');
  }
  const clash = existing.find((branch) => String(branch).toLowerCase() === trimmed.toLowerCase());
  if (clash === trimmed) {
    return translate('git.branch.error.exists', { branch: trimmed });
  }
  if (clash) {
    return translate('git.branch.error.existsCase', { branch: clash });
  }
  const nested = existing.find((branch) => String(branch).startsWith(`${trimmed}/`) || trimmed.startsWith(`${String(branch)}/`));
  if (nested !== undefined) {
    return translate('git.branch.error.conflict', { branch: nested });
  }
  return undefined;
}

export function isValidBranchName(name: unknown, existing: readonly string[] = []): boolean {
  const trimmed = String(name ?? '').trim();
  return !!trimmed && !branchNameError(trimmed, existing);
}
