import { assert } from '../../../shared/core/assert';
import type { EditorNode } from '../../editor/pageView';
import type { CodeEditorIndentation } from '../../ui/CodeEditor';
import { codeIndentStyleFor } from '../../ui/codeIndentStyle';

export interface CodeWindowState {
  readonly kind?: 'file';
  readonly area?: 'src';
  readonly targetId?: string;
  readonly rel?: string;
  readonly title: string;
  readonly language: string;
  readonly indentation?: CodeEditorIndentation;
  readonly revealLine?: number;
  readonly revealSerial?: number;
}

export interface FrontmatterSubject {
  readonly id: 'frontmatter';
  readonly kind: 'frontmatter';
}

export type CodeSubject = EditorNode | FrontmatterSubject;

export const FRONTMATTER_SUBJECT: FrontmatterSubject = { id: 'frontmatter', kind: 'frontmatter' };

export function codeWindowFor(subject: CodeSubject): CodeWindowState | undefined {
  if (subject.kind === 'frontmatter') {
    return { targetId: 'frontmatter', title: 'Frontmatter', language: 'javascript' };
  }
  if (subject.kind === 'raw') {
    assert(subject.id.length > 0, 'raw node has an id');
    const language = RAW_CODE_LANGUAGES[subject.name.toLowerCase()];
    assert(language !== undefined, `raw node <${subject.name}> has no code language`);
    return { targetId: subject.id, title: `<${subject.name}>`, language, indentation: 'block' };
  }
  return undefined;
}

const RAW_CODE_LANGUAGES: Readonly<Record<string, string>> = {
  script: 'javascript',
  style: 'css',
};

export function fileWindowIndentation(path: string): Pick<CodeWindowState, 'indentation'> {
  assert(path.length > 0, 'fileWindowIndentation: a file window has a path');
  return codeIndentStyleFor(path) === 'spaces' ? { indentation: 'spaces' } : {};
}
