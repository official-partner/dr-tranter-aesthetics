
import { indentLess, indentMore, insertTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { CODE_INDENT_UNIT, CODE_TAB_WIDTH } from '../../shared/core/indent';
import type { CodeIndentStyle } from './codeIndentStyle';

export { codeIndentStyleFor, type CodeIndentStyle } from './codeIndentStyle';

const SPACE_INDENT_UNIT = ' '.repeat(CODE_TAB_WIDTH);

export function codeIndentSettings(style: CodeIndentStyle = 'tabs'): readonly Extension[] {
  return [EditorState.tabSize.of(CODE_TAB_WIDTH), indentUnit.of(style === 'spaces' ? SPACE_INDENT_UNIT : CODE_INDENT_UNIT)];
}

export function codeIndentExtensions(style: CodeIndentStyle = 'tabs'): readonly Extension[] {
  const tabKey = style === 'spaces' ? { key: 'Tab', run: indentMore, shift: indentLess } : { key: 'Tab', run: insertTab, shift: indentLess };
  return [...codeIndentSettings(style), Prec.high(keymap.of([tabKey]))];
}
