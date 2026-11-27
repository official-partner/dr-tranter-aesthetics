
import { css } from '@codemirror/lang-css';
import { indentOnInput } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { codeIndentExtensions } from '../../../ui/codeEditorIndent';

export function cssEditorIndentExtensions(): readonly Extension[] {
  return [css(), ...codeIndentExtensions(), indentOnInput()];
}
