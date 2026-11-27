import { useState } from 'react';
import Dropdown, { type DropdownOption } from '../../ui/Dropdown';
import { CodeInline } from '../../ui/CodeBlock';
import { ErrorToast } from '../../ui/ErrorToast';
import { useSettledMessage } from '../../ui/useSettledMessage';
import { assert } from '../../../shared/core/assert';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import {
  COMMIT_CONVENTION_NONE,
  COMMIT_SCOPE_LENGTH_MAX,
  COMMIT_TYPE_DESCRIPTIONS,
  COMMIT_TYPES,
  parseCommitScope,
  type CommitConvention,
  type CommitTypeName,
} from './commitType';
import { commitTypeProjectKey, loadCommitType, saveCommitType } from './commitTypePreference';

const NO_TYPE = 'none';

const COMMIT_TYPE_KEYWORDS = {
  feat: 'add new page section component',
  fix: 'bug broken repair',
  content: 'text copy words image photo data cms',
  style: 'css design colour color layout spacing font',
  refactor: 'cleanup reorganise reorganize tidy',
  perf: 'performance speed slow fast size',
  docs: 'readme documentation',
  chore: 'maintenance housekeeping',
  build: 'dependency dependencies package npm astro config',
  ci: 'github actions workflow pipeline deploy',
  test: 'tests testing spec',
  revert: 'undo rollback',
} as const satisfies Record<CommitTypeName, string>;
type CommitTypeChoice = CommitTypeName | typeof NO_TYPE;

const COMMIT_TYPE_DESCRIPTION_KEYS = {
  feat: 'git.type.description.feat',
  fix: 'git.type.description.fix',
  content: 'git.type.description.content',
  style: 'git.type.description.style',
  refactor: 'git.type.description.refactor',
  perf: 'git.type.description.perf',
  docs: 'git.type.description.docs',
  chore: 'git.type.description.chore',
  build: 'git.type.description.build',
  ci: 'git.type.description.ci',
  test: 'git.type.description.test',
  revert: 'git.type.description.revert',
} as const satisfies Record<CommitTypeName, MessageKey>;

function typeOptions(translate: Translator): readonly DropdownOption<CommitTypeChoice>[] {
  return [
    { value: NO_TYPE, label: translate('git.type.none'), description: translate('git.type.noneDescription'), dim: true, pinned: true },
    ...COMMIT_TYPES.map((type) => ({
      value: type,
      label: type,
      description: translate(COMMIT_TYPE_DESCRIPTION_KEYS[type]),
      keywords: `${translate(COMMIT_TYPE_DESCRIPTION_KEYS[type])} ${COMMIT_TYPE_DESCRIPTIONS[type]} ${COMMIT_TYPE_KEYWORDS[type]}`,
    })),
  ];
}

export type CommitTypeState = { readonly kind: 'ready'; readonly convention: CommitConvention } | { readonly kind: 'invalid'; readonly error: string };

export interface CommitTypeControl {
  readonly type: CommitTypeName | undefined;
  readonly scopeText: string;
  readonly breaking: boolean;
  readonly state: CommitTypeState;
  readonly setType: (type: CommitTypeName | undefined) => void;
  readonly setScopeText: (text: string) => void;
  readonly setBreaking: (breaking: boolean) => void;
  readonly resetForNextCommit: () => void;
}

export function useCommitType(project: { readonly path: string; readonly name: string }): CommitTypeControl {
  const translate = useTranslate();
  const projectKey = commitTypeProjectKey(project);
  const [choice, setChoice] = useState(() => ({ projectKey, type: loadCommitType(projectKey) }));
  const [scopeText, setScopeText] = useState('');
  const [breaking, setBreaking] = useState(false);
  const type = choice.projectKey === projectKey ? choice.type : loadCommitType(projectKey);
  if (choice.projectKey !== projectKey) {
    setChoice({ projectKey, type });
  }
  return {
    type,
    scopeText,
    breaking,
    state: commitTypeState({ type, scopeText, breaking }, translate),
    setType: (next) => {
      setChoice({ projectKey, type: next });
      saveCommitType(projectKey, next);
      if (next === undefined) {
        setScopeText('');
        setBreaking(false);
      }
    },
    setScopeText,
    setBreaking,
    resetForNextCommit: () => {
      setScopeText('');
      setBreaking(false);
    },
  };
}

export function commitTypeState(
  {
    type,
    scopeText,
    breaking,
  }: {
    readonly type: CommitTypeName | undefined;
    readonly scopeText: string;
    readonly breaking: boolean;
  },
  translate: Translator = ENGLISH_TRANSLATE,
): CommitTypeState {
  if (type === undefined) {
    return { kind: 'ready', convention: COMMIT_CONVENTION_NONE };
  }
  const scope = parseCommitScope(scopeText, translate);
  if (scope.ok) {
    return { kind: 'ready', convention: { kind: 'typed', type, scope: scope.value, breaking } };
  }
  return { kind: 'invalid', error: scope.error };
}

export function commitTypeConvention(control: Pick<CommitTypeControl, 'type' | 'state' | 'breaking'>): CommitConvention {
  if (control.state.kind === 'ready') {
    return control.state.convention;
  }
  assert(control.type !== undefined, 'Commit type: only a typed choice has a scope to reject');
  return { kind: 'typed', type: control.type, scope: undefined, breaking: control.breaking };
}

export function CommitTypeSelect({ control, disabled }: { readonly control: CommitTypeControl; readonly disabled: boolean }) {
  const translate = useTranslate();
  return (
    <Dropdown<CommitTypeChoice>
      className="git-commit-type"
      ariaLabel={translate('git.type.label')}
      disabled={disabled}
      value={control.type ?? NO_TYPE}
      options={typeOptions(translate)}
      optionLayout="stacked"
      menuWidthMin={240}
      searchable={true}
      searchPlaceholder={translate('git.type.search')}
      livePreview={false}
      onChange={(value) => control.setType(value === NO_TYPE ? undefined : value)}
    />
  );
}

export function CommitTypeDetails({ control, disabled }: { readonly control: CommitTypeControl; readonly disabled: boolean }) {
  const translate = useTranslate();
  if (control.type === undefined) {
    return undefined;
  }
  const invalid = control.state.kind === 'invalid';
  return (
    <>
      <input
        className="git-commit-scope"
        placeholder={translate('git.type.scopePlaceholder')}
        aria-label={translate('git.type.scopeLabel')}
        aria-invalid={invalid ? true : undefined}
        maxLength={COMMIT_SCOPE_LENGTH_MAX + 1}
        disabled={disabled}
        value={control.scopeText}
        onChange={(event) => control.setScopeText(event.target.value)}
      />
      <label className="check-row" title={translate('git.type.breakingHint')}>
        <input type="checkbox" checked={control.breaking} disabled={disabled} onChange={(event) => control.setBreaking(event.target.checked)} />
        {translate('git.type.breaking')}
      </label>
    </>
  );
}

const SCOPE_SETTLE_MS = 900;

export function CommitTypeScopeError({ control }: { readonly control: CommitTypeControl }) {
  const settled = useSettledMessage(control.state.kind === 'invalid' ? control.state.error : undefined, SCOPE_SETTLE_MS);
  return <ErrorToast message={settled} />;
}

export function CommitSubjectPreview({ subject, convention }: { readonly subject: string | undefined; readonly convention: CommitConvention | undefined }) {
  if (subject === undefined || convention === undefined || convention.kind === 'none') {
    return undefined;
  }
  assert(subject.length > 0, 'Commit preview: a subject is never empty');
  return <CodeInline className="git-commit-preview" text={subject} language="commit" />;
}
