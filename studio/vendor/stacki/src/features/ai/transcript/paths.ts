import { assert } from '../../../../shared/core/assert';

export function relativePath(file: string, projectPath: string): string {
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
  return file.startsWith(root) ? file.slice(root.length) : file;
}

export function relativeTitle(title: string, projectPath: string): string {
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
  return title.split(root).join('');
}

export function middleEllipsis(text: string, max: number): string {
  assert(max >= 8, 'middleEllipsis: room for a start, an ellipsis and an end');
  if (text.length <= max) {
    return text;
  }
  const name = text.length - text.lastIndexOf('/') - 1;
  const tail = Math.min(name, Math.floor((max * 2) / 3));
  const head = max - tail - 1;
  const shown = `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
  assert(shown.length === max, 'middleEllipsis: exactly the room given');
  return shown;
}
