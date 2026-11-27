
import { assert } from '../../../shared/core/assert';
import { err, ok, type Result } from '../../../shared/core/result';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';

export const COMMIT_TYPES = ['feat', 'fix', 'content', 'style', 'refactor', 'perf', 'docs', 'chore', 'build', 'ci', 'test', 'revert'] as const;
export type CommitTypeName = (typeof COMMIT_TYPES)[number];

export const COMMIT_TYPE_DESCRIPTIONS = {
  feat: 'a new feature',
  fix: 'a bug fix',
  content: 'copy, images or data',
  style: 'visual or CSS change',
  refactor: 'restructure without changing behaviour',
  perf: 'faster or lighter',
  docs: 'documentation only',
  chore: 'upkeep, nothing visible changes',
  build: 'build setup or dependencies',
  ci: 'automation and checks',
  test: 'tests only',
  revert: 'undo an earlier commit',
} as const satisfies Record<CommitTypeName, string>;

export const COMMIT_SCOPE_LENGTH_MAX = 32;

declare const commitScopeBrand: unique symbol;
export type CommitScope = string & { readonly [commitScopeBrand]: 'CommitScope' };

export type CommitConvention =
  { readonly kind: 'none' } | { readonly kind: 'typed'; readonly type: CommitTypeName; readonly scope: CommitScope | undefined; readonly breaking: boolean };

export const COMMIT_CONVENTION_NONE: CommitConvention = { kind: 'none' };

const SCOPE_FORBIDDEN = /[\s():]/;

export function parseCommitScope(raw: string, translate: Translator = ENGLISH_TRANSLATE): Result<CommitScope | undefined, string> {
  const scope = raw.trim();
  if (scope.length === 0) {
    return ok(undefined);
  }
  if (scope.length > COMMIT_SCOPE_LENGTH_MAX) {
    return err(translate('git.type.scopeTooLong', { max: COMMIT_SCOPE_LENGTH_MAX }));
  }
  if (SCOPE_FORBIDDEN.test(scope)) {
    return err(translate('git.type.scopeInvalid'));
  }
  assert(isCommitScope(scope), 'Commit scope: a checked scope satisfies the scope rules');
  return ok(scope);
}

export function parseCommitTypeName(raw: unknown): CommitTypeName | undefined {
  if (typeof raw === 'string') {
    return COMMIT_TYPES.find((type) => type === raw);
  }
  return undefined;
}

export function buildCommitSubject(message: string, convention: CommitConvention, fallback: string): string {
  assert(fallback.trim().length > 0, 'Commit subject: the fallback message is non-empty');
  assert(!fallback.includes('\n'), 'Commit subject: the fallback message is one line');
  const typed = message.trim();
  switch (convention.kind) {
    case 'none': {
      const subject = typed || fallback;
      assert(subject.length > 0, 'Commit subject: an untyped subject is non-empty');
      return subject;
    }
    case 'typed': {
      if (convention.scope !== undefined) {
        assert(parseCommitScope(convention.scope).ok, 'Commit subject: the scope was parsed');
      }
      const body = stripCommitTypePrefix(typed) || fallback;
      const scope = convention.scope === undefined ? '' : `(${convention.scope})`;
      const subject = `${convention.type}${scope}${convention.breaking ? '!' : ''}: ${body}`;
      assert(subject.startsWith(convention.type), 'Commit subject: a typed subject leads with its type');
      assert(stripCommitTypePrefix(subject) === body, 'Commit subject: the prefix is written once');
      return subject;
    }
    default: {
      const exhaustive: never = convention;
      return exhaustive;
    }
  }
}

const TYPE_PREFIX = new RegExp(`^(?:${COMMIT_TYPES.join('|')})(?:\\([^()\\s:]*\\))?!?:\\s*`, 'i');

export function stripCommitTypePrefix(message: string): string {
  return message.replace(TYPE_PREFIX, '').trim();
}

function isCommitScope(scope: string): scope is CommitScope {
  if (scope.length === 0) {
    return false;
  }
  if (scope.length <= COMMIT_SCOPE_LENGTH_MAX) {
    return !SCOPE_FORBIDDEN.test(scope);
  }
  return false;
}
