import { assert } from '../core/assert';
import { APP_HOST_FOLDER } from './apps';
import {
  APP_UI_COMPONENTS_CSS,
  APP_UI_SCRIPT,
  APP_UI_THEMES,
  APP_UI_TOKEN_NAMES,
  APP_UI_TOKEN_VALUES,
  APP_UI_TOKENS_CSS,
  type AppUiTheme,
  type AppUiTokenName,
} from './generated/appUiKitBundle';

export { APP_UI_THEMES, APP_UI_TOKEN_NAMES, type AppUiTheme, type AppUiTokenName } from './generated/appUiKitBundle';

export const APP_UI_DEFAULT_THEME: AppUiTheme = 'dark';

export const APP_FRAME_COLOR_SCHEME: AppUiTheme = APP_UI_DEFAULT_THEME;

export const APP_FRAME_SURFACE = { background: 'transparent', colorScheme: APP_FRAME_COLOR_SCHEME } as const;

const APP_FRAME_ROOT_CSS = `:where(:root) {\n  color-scheme: ${APP_FRAME_COLOR_SCHEME};\n}`;

export const APP_UI_KIT_FILES = {
  'tokens.css': 'text/css; charset=utf-8',
  'ui.css': 'text/css; charset=utf-8',
  'ui.js': 'text/javascript; charset=utf-8',
} as const;
export type AppUiKitFile = keyof typeof APP_UI_KIT_FILES;
const APP_UI_KIT_FILE_NAMES: readonly AppUiKitFile[] = ['tokens.css', 'ui.css', 'ui.js'];

export type AppHostAsset =
  | { readonly kind: 'kit'; readonly file: AppUiKitFile; readonly type: string; readonly body: string }
  | { readonly kind: 'reserved' }
  | { readonly kind: 'bundle' };

export interface AppThemeView {
  readonly theme: AppUiTheme;
  readonly tokens: { readonly [N in AppUiTokenName]: string };
}

export function isAppHostPath(bundlePath: string): boolean {
  const first = bundlePath.replace(/^\/+/, '').split('/')[0] ?? '';
  assert(!first.includes('/'), 'A first path segment has no slash');
  return first.toLowerCase() === APP_HOST_FOLDER;
}

export function appHostAsset(filePath: string): AppHostAsset {
  assert(!filePath.startsWith('/'), 'The path is relative to the app origin');
  if (!isAppHostPath(filePath)) {
    return { kind: 'bundle' };
  }
  const exact = filePath.startsWith(`${APP_HOST_FOLDER}/`);
  const name = filePath.slice(APP_HOST_FOLDER.length + 1);
  const file = exact ? APP_UI_KIT_FILE_NAMES.find((candidate) => candidate === name) : undefined;
  if (file === undefined) {
    return { kind: 'reserved' };
  }
  const body = appUiKitBody(file);
  assert(body.length > 0, 'Every kit file has content');
  return { kind: 'kit', file, type: APP_UI_KIT_FILES[file], body };
}

export function withAppTokens(file: { readonly bytes: Uint8Array; readonly type: string }): Uint8Array {
  if (!file.type.startsWith('text/html')) {
    return file.bytes;
  }
  const html = new TextDecoder().decode(file.bytes);
  const style = `<style data-stacki-tokens>\n${APP_FRAME_ROOT_CSS}\n${APP_UI_TOKENS_CSS}\n</style>\n`;
  const at = tokenInsertionIndex(html);
  assert(at >= 0, 'The tokens go inside the document');
  assert(at <= html.length, 'The tokens go inside the document');
  return new TextEncoder().encode(html.slice(0, at) + style + html.slice(at));
}

export function appThemeView(theme: AppUiTheme): AppThemeView {
  const tokens = APP_UI_TOKEN_VALUES[theme];
  assert(Object.keys(tokens).length === APP_UI_TOKEN_NAMES.length, 'A theme has every token');
  assert(APP_UI_THEMES.includes(theme), 'The theme is one the kit has');
  return { theme, tokens };
}

export function parseAppUiTheme(input: unknown): AppUiTheme {
  const theme = APP_UI_THEMES.find((candidate) => candidate === input) ?? APP_UI_DEFAULT_THEME;
  assert(APP_UI_THEMES.includes(theme), 'A parsed theme is one the kit has');
  return theme;
}

function appUiKitBody(file: AppUiKitFile): string {
  switch (file) {
    case 'tokens.css':
      return `${APP_UI_TOKENS_CSS}\n`;
    case 'ui.css':
      return `/* Stacki app UI kit, built from the editor's CSS. See docs/apps.md, "Look and feel". */\n${APP_UI_TOKENS_CSS}\n${APP_UI_COMPONENTS_CSS}\n`;
    case 'ui.js':
      return APP_UI_SCRIPT;
    default: {
      const exhaustive: never = file;
      return exhaustive;
    }
  }
}

function tokenInsertionIndex(html: string): number {
  const lower = html.toLowerCase();
  const headEnd = lower.indexOf('</head');
  if (headEnd >= 0) {
    return headEnd;
  }
  const body = lower.indexOf('<body');
  if (body >= 0) {
    return body;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype === null ? 0 : doctype[0].length;
}
