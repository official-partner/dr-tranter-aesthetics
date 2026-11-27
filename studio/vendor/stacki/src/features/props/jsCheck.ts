import { LIMITS } from '../../../shared/core/limits';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';

import { parser } from '@lezer/javascript';

const ts = parser.configure({ dialect: 'ts' });

function firstError(code: string): number {
  const tree = ts.parse(code);
  let at = -1;
  tree.iterate({
    enter: (node) => {
      if (at >= 0) {
        return false;
      }
      if (node.type.isError) {
        at = node.from;
        return false;
      }
      return true;
    },
  });
  return at;
}

export function isExpression(code: string): boolean {
  if (code.trim() === '' || code.length > LIMITS.attrCharsMax) {
    return false;
  }
  return firstError(`(${code});`) < 0;
}

function lineOf(code: string, position: number): number {
  return code.slice(0, position).split('\n').length;
}

function tokenAt(code: string, position: number): string {
  const rest = code.slice(position);
  const match = rest.match(/^\s*([A-Za-z_$][\w$]*|[^\s\w$])/);
  return match?.[1] ?? '';
}

export type StatementCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function checkStatement(code: unknown, translate: Translator = ENGLISH_TRANSLATE): StatementCheck {
  const source = String(code ?? '');
  if (source.length > LIMITS.nodeValueCharsMax) {
    return { ok: false, message: translate('props.jsCheck.tooLong') };
  }
  if (!source.trim()) {
    return { ok: true };
  }
  const at = firstError(source);
  if (at < 0) {
    return { ok: true };
  }
  const token = tokenAt(source, at);
  const line = lineOf(source, at);
  const multiline = source.split('\n').length > 1;
  if (at >= source.trimEnd().length) {
    return { ok: false, message: translate('props.jsCheck.unfinished') };
  }
  if (token === '') {
    return { ok: false, message: multiline ? translate('props.jsCheck.mistakeOnLine', { line }) : translate('props.jsCheck.mistake') };
  }
  return { ok: false, message: multiline ? translate('props.jsCheck.unexpectedOnLine', { token, line }) : translate('props.jsCheck.unexpected', { token }) };
}
