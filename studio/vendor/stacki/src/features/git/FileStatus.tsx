import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';

const WORDS = {
  A: { word: 'git.file.new', why: 'git.file.new.why', inVersion: 'git.file.new.inVersion' },
  M: { word: 'git.file.changed', why: 'git.file.changed.why', inVersion: 'git.file.changed.inVersion' },
  D: { word: 'git.file.deleted', why: 'git.file.deleted.why', inVersion: 'git.file.deleted.inVersion' },
  R: { word: 'git.file.moved', why: 'git.file.moved.why', inVersion: 'git.file.moved.inVersion' },
  C: { word: 'git.file.copied', why: 'git.file.copied.why', inVersion: 'git.file.copied.inVersion' },
  U: { word: 'git.file.clashing', why: 'git.file.clashing.why', inVersion: 'git.file.clashing.inVersion' },
} as const satisfies Record<string, { readonly word: MessageKey; readonly why: MessageKey; readonly inVersion: MessageKey }>;

function isStatusLetter(status: string): status is keyof typeof WORDS {
  return Object.hasOwn(WORDS, status);
}

export default function FileStatus({ status, inCommit = false }: { readonly status?: string | undefined; readonly inCommit?: boolean }) {
  const translate = useTranslate();
  if (!status) {
    return undefined;
  }
  const known = isStatusLetter(status) ? WORDS[status] : undefined;
  const word = known ? translate(known.word) : status;
  const why = known ? translate(inCommit ? known.inVersion : known.why) : translate('git.file.unknownWhy', { status });
  return (
    <span className={`file-status s-${status}`} title={why}>
      {word}
    </span>
  );
}
