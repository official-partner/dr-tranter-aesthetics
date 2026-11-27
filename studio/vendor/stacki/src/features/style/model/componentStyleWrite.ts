
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';
import { englishText, messageRef } from '../../../../shared/properties/i18n/messageRef';
import { styleTransport } from '../../../ipc/editorEnvironment';
import { rememberComponentSource } from './componentSourceCache';
import { getHost } from './host';

export function componentStyleText(source: { readonly text: string; readonly start: number; readonly end: number }, expression: string): string {
  assert(source.start <= source.end, 'componentStyleText: the span has an order');
  assert(source.end <= source.text.length, 'componentStyleText: the span is inside the file');
  assert(expression.length <= LIMITS.attrCharsMax, 'componentStyleText: an attribute is inside its bound');
  return source.text.slice(0, source.start) + expression + source.text.slice(source.end);
}

export async function writeComponentStyle(path: string, label: string, texts: { readonly before: string; readonly after: string }): Promise<void> {
  const { before, after } = texts;
  if (before === after) {
    return;
  }
  rememberComponentSource(path, after);
  try {
    await styleTransport.writeStyleFile({ filePath: path, css: after, base: before });
  } catch (error: unknown) {
    rememberComponentSource(path, before);
    throw error;
  }
  const stylesIn = messageRef('shell.history.inlineStylesIn', { name: label });
  getHost().recordUndo?.({
    label: englishText(stylesIn),
    labelRef: stylesIn,
    undo: async () => {
      rememberComponentSource(path, before);
      await styleTransport.writeStyleFile({ filePath: path, css: before, base: after });
    },
    redo: async () => {
      rememberComponentSource(path, after);
      await styleTransport.writeStyleFile({ filePath: path, css: after, base: before });
    },
  });
}
