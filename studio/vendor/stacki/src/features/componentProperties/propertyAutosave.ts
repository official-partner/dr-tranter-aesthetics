
import { useCallback, useEffect, useRef, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import type { Result } from '../../../shared/core/result';
import type { PropertyError } from '../../../shared/properties/propertyErrors';
import { propertyErrorTextFor } from '../../lib/i18n/propertyErrorText';
import { reportErrorToast } from '../../ui/errorNotices';
import type { ComponentProperty, PropertyChange, PropertyOptionRename } from '../../../shared/properties/propertyEditing';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { PROPERTY_LIMITS } from '../../../shared/properties/propertyEditing';
import type { EditPace } from '../props/propBindings';

export const AUTOSAVE_DELAY_MS = 600;
const AUTOSAVE_PASSES_MAX = 16;
const NAME = /^[A-Za-z_$][\w$]*$/;
const STATED_FIELDS = ['name', 'type', 'required', 'readonly', 'defaultValue', 'description'] as const;

export const CONFLICT_NOTICE = 'This file changed on disk, so the form reloaded. Your edit was kept.';

export interface PropertyDraft {
  readonly property: ComponentProperty;
  readonly optionRenames: readonly PropertyOptionRename[];
}

export type PropertySaveOutcome =
  | { readonly kind: 'saved'; readonly source: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'name-refused'; readonly message: string }
  | { readonly kind: 'conflict'; readonly message: string };

const NAME_REFUSALS: ReadonlySet<string> = new Set(['name', 'duplicate']);

export function refusalOf(error: PropertyError, translate: Translator): PropertySaveOutcome {
  assert(error.message !== '', 'refusalOf: a refusal says why');
  const message = propertyErrorTextFor(error, translate);
  if (error.code === 'conflict') {
    return { kind: 'conflict', message };
  }
  return { kind: NAME_REFUSALS.has(error.code) ? 'name-refused' : 'refused', message };
}

export interface PropertySaveHost {
  readonly save: (change: PropertyChange) => Promise<PropertySaveOutcome>;
  readonly reload: (name: string) => Promise<Result<ComponentProperty, string>>;
}

export function savePhaseOf(change: PropertyChange): 'saving' | 'autosaving' {
  if (change.kind === 'save' && change.originalName !== change.property.name) {
    return 'saving';
  }
  if (change.kind === 'variantRules' && change.edit.kind === 'renameOption') {
    return 'saving';
  }
  return 'autosaving';
}

export function propertyProblem(property: Pick<ComponentProperty, 'name' | 'type'>, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (!NAME.test(property.name)) {
    return translate('componentProps.problem.nameShape');
  }
  return property.type.trim() === '' ? translate('componentProps.problem.typeMissing') : undefined;
}

function sameStatement(left: ComponentProperty, right: ComponentProperty): boolean {
  return STATED_FIELDS.every((key) => left[key] === right[key]);
}

export function mergedProperty(base: ComponentProperty, draft: ComponentProperty, fresh: ComponentProperty): ComponentProperty {
  const out = STATED_FIELDS.reduce((merged, key) => (draft[key] === base[key] ? merged : { ...merged, [key]: draft[key] }), fresh);
  assert(out.editing === fresh.editing, 'mergedProperty: what the file says about editing is the file’s');
  return out;
}

interface FormStatus {
  readonly error: string;
  readonly nameError: string;
  readonly notice: string;
  readonly savedName: string;
}

interface Autosave {
  draft: PropertyDraft;
  saved: ComponentProperty;
  nameText: string;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
  refused: ComponentProperty | undefined;
  conflictRetried: boolean;
  hold: 'free' | 'held';
  mounted: boolean;
}

export function usePropertyAutosave(initial: PropertyDraft, host: PropertySaveHost | undefined) {
  const translate = useTranslate();
  const translateRef = useRef(translate);
  translateRef.current = translate;
  const [draft, setDraft] = useState(initial);
  const [nameText, setNameText] = useState(initial.property.name);
  const [status, setStatus] = useState<FormStatus>({ error: '', nameError: '', notice: '', savedName: initial.property.name });
  const state = useRef<Autosave>({
    draft: initial,
    saved: initial.property,
    nameText: initial.property.name,
    timer: undefined,
    running: false,
    refused: undefined,
    conflictRetried: false,
    hold: 'free',
    mounted: true,
  });
  const hostRef = useRef(host);
  hostRef.current = host;

  const report = useCallback((next: Pick<FormStatus, 'error' | 'notice'> & { readonly nameError?: string }): void => {
    const nameError = next.nameError ?? '';
    if (state.current.mounted) {
      setStatus((previous) => ({ ...previous, ...next, nameError }));
    } else if (next.error !== '') {
      reportErrorToast(next.error, []);
    } else if (nameError !== '') {
      reportErrorToast(nameError, []);
    }
  }, []);

  const replaceDraft = useCallback((next: PropertyDraft): void => {
    state.current.draft = next;
    if (state.current.mounted) {
      setDraft(next);
    }
  }, []);

  const recover = useCallback(
    async (target: PropertySaveHost, message: string): Promise<'retry' | 'stop'> => {
      const own = state.current;
      if (own.conflictRetried) {
        report({ error: message, notice: '' });
        return 'stop';
      }
      own.conflictRetried = true;
      const fresh = await target.reload(own.saved.name);
      if (!fresh.ok) {
        report({ error: fresh.error, notice: '' });
        return 'stop';
      }
      const property = mergedProperty(own.saved, own.draft.property, fresh.value);
      own.saved = fresh.value;
      replaceDraft({ ...own.draft, property });
      report({ error: '', notice: translateRef.current('componentProps.autosave.conflict') });
      return 'retry';
    },
    [replaceDraft, report],
  );

  const landed = useCallback(
    (sent: PropertyDraft): void => {
      const own = state.current;
      own.saved = sent.property;
      own.conflictRetried = false;
      own.refused = undefined;
      replaceDraft({ ...own.draft, optionRenames: own.draft.optionRenames.filter((rename) => !sent.optionRenames.includes(rename)) });
      if (own.mounted) {
        setStatus((previous) => ({ ...previous, error: '', nameError: '', savedName: sent.property.name }));
      }
    },
    [replaceDraft],
  );

  const pump = useCallback(async (): Promise<void> => {
    const own = state.current;
    const target = hostRef.current;
    if (target === undefined || own.running) {
      return;
    }
    own.running = true;
    try {
      for (let pass = 0; pass < AUTOSAVE_PASSES_MAX; pass++) {
        const sent = own.draft;
        if (own.timer !== undefined || own.hold === 'held' || own.refused === sent.property) {
          return;
        }
        if (sameStatement(sent.property, own.saved) && sent.optionRenames.length === 0) {
          return;
        }
        const problem = propertyProblem(sent.property, translateRef.current);
        if (problem !== undefined) {
          report({ error: problem, notice: '' });
          return;
        }
        const options = sent.optionRenames.length > 0 ? { optionRenames: sent.optionRenames } : {};
        const outcome = await target.save({ kind: 'save', originalName: own.saved.name, property: sent.property, ...options });
        switch (outcome.kind) {
          case 'saved':
            landed(sent);
            break;
          case 'refused':
            own.refused = sent.property;
            report({ error: outcome.message, notice: '' });
            return;
          case 'name-refused':
            own.refused = sent.property;
            report({ error: '', nameError: outcome.message, notice: '' });
            return;
          case 'conflict':
            if ((await recover(target, outcome.message)) === 'stop') {
              return;
            }
            break;
          default: {
            const exhaustive: never = outcome;
            return exhaustive;
          }
        }
      }
    } finally {
      own.running = false;
    }
  }, [landed, recover, report]);

  const stopTimer = useCallback((): void => {
    const own = state.current;
    if (own.timer !== undefined) {
      clearTimeout(own.timer);
      own.timer = undefined;
    }
  }, []);

  const change = useCallback(
    (pace: EditPace, next: (current: PropertyDraft) => PropertyDraft): void => {
      const own = state.current;
      replaceDraft(next(own.draft));
      report({ error: '', notice: '' });
      if (hostRef.current === undefined) {
        return;
      }
      stopTimer();
      if (pace === 'at-once') {
        void pump();
        return;
      }
      own.timer = setTimeout(() => {
        own.timer = undefined;
        void pump();
      }, AUTOSAVE_DELAY_MS);
    },
    [pump, replaceDraft, report, stopTimer],
  );

  const commitName = useCallback((): void => {
    const own = state.current;
    if (own.nameText === own.draft.property.name) {
      return;
    }
    const problem = propertyProblem({ name: own.nameText, type: own.draft.property.type }, translateRef.current);
    if (problem !== undefined) {
      report({ error: problem, notice: '' });
      return;
    }
    const name = own.nameText;
    change('at-once', (current) => ({ ...current, property: { ...current.property, name } }));
  }, [change, report]);

  const flush = useCallback((): void => {
    if (hostRef.current === undefined) {
      return;
    }
    stopTimer();
    commitName();
    void pump();
  }, [commitName, pump, stopTimer]);

  const close = useCallback((): void => {
    state.current.mounted = false;
    flush();
  }, [flush]);

  useEffect(() => {
    state.current.mounted = true;
    return close;
  }, [close]);

  const setName = (text: string): void => {
    assert(text.length <= PROPERTY_LIMITS.textCharsMax, 'usePropertyAutosave: a name box is bounded');
    state.current.nameText = text;
    setNameText(text);
    if (hostRef.current === undefined) {
      change('typing', (current) => ({ ...current, property: { ...current.property, name: text } }));
    }
  };

  const adopt = useCallback(
    (created: ComponentProperty, target: PropertySaveHost): void => {
      assert(hostRef.current === undefined, 'adopt: only a new prop is adopted');
      assert(created.name !== '', 'adopt: the created prop has a name');
      const own = state.current;
      own.saved = created;
      hostRef.current = target;
      if (own.mounted) {
        setStatus((previous) => ({ ...previous, error: '', nameError: '', savedName: created.name }));
      }
      void pump();
    },
    [pump],
  );

  return {
    draft,
    nameText,
    ...status,
    change,
    setName,
    commitName,
    adopt,
    close,
    report,
    hold: (hold: Autosave['hold']): void => {
      state.current.hold = hold;
    },
    rebase: (fresh: ComponentProperty): void => {
      const own = state.current;
      assert(fresh.name === own.saved.name, 'rebase: the file holds the prop by the name the form saved');
      const property = mergedProperty(own.saved, own.draft.property, fresh);
      own.saved = fresh;
      own.refused = undefined;
      replaceDraft({ ...own.draft, property });
    },
    discard: (): void => {
      stopTimer();
      const own = state.current;
      own.nameText = own.saved.name;
      replaceDraft({ property: own.saved, optionRenames: [] });
    },
  };
}
