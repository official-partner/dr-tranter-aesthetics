
import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Completion } from '@codemirror/autocomplete';
import ExprInput from '../../ui/ExprInput';
import { useCodeAccess } from '../../ui/CodeAccess';
import { BracesIcon } from '../../ui/Icons';
import { AppliedLabel } from './LoopRows';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { LoopSection, LoopSections } from '../../editor/loopSections';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';

export interface SectionCodeContext {
  readonly sections: LoopSections;
  readonly problemOf: (section: LoopSection, code: string) => string | undefined;
  readonly refusalOf: (section: LoopSection, code: string) => string | undefined;
  readonly write: (section: LoopSection, code: string) => string | undefined;
  readonly completions: (section: LoopSection) => readonly Completion[];
  readonly placeholder: (section: LoopSection) => string;
}

const SECTION_TITLE_KEYS: Readonly<Record<LoopSection, MessageKey>> = {
  filter: 'props.loop.filters.title',
  sort: 'props.loop.sort.title',
  limit: 'props.loop.limit.title',
};

export interface SectionCodeView {
  readonly toggle: ReactNode;
  readonly editor: ReactNode;
}

export function useSectionCode(section: LoopSection, context: SectionCodeContext | undefined): SectionCodeView {
  const translate = useTranslate();
  const access = useCodeAccess();
  const reading = context?.sections[section];
  const code = reading?.code ?? '';
  const custom = reading?.custom;
  const [open, setOpen] = useState(custom !== undefined);
  const [draft, setDraft] = useState(code);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDraft(code);
    setProblem(undefined);
  }, [code]);
  useEffect(() => {
    if (custom !== undefined) {
      setOpen(true);
    }
  }, [custom]);
  if (context === undefined) {
    return { toggle: undefined, editor: undefined };
  }
  const shown = open || custom !== undefined;
  const commit = (text: string): boolean => {
    const next = text.trim();
    if (next === code.trim()) {
      setProblem(undefined);
      return true;
    }
    const found = context.problemOf(section, next) ?? context.write(section, next);
    setProblem(found);
    return found === undefined;
  };
  const press = (): void => {
    if (!shown) {
      setOpen(true);
      return;
    }
    if (!commit(draft)) {
      return;
    }
    const refusal = context.refusalOf(section, draft);
    if (refusal === undefined) {
      setOpen(false);
    }
    setProblem(refusal);
  };
  const toggle = access ? <SectionCodeToggle section={section} on={shown} onPress={press} /> : undefined;
  return {
    toggle,
    editor: shown ? (
      <div className="loop-settings-section">
        <div className="loop-settings-header">
          <span className="loop-settings-label">
            {}
            <AppliedLabel
              title={translate(SECTION_TITLE_KEYS[section])}
              reset={{
                applied: code.trim() !== '',
                onReset: () => {
                  commit('');
                },
              }}
            />
            {toggle}
          </span>
        </div>
        <div className="loop-section-code">
          <ExprInput
            value={draft}
            syncValue={code}
            placeholder={context.placeholder(section)}
            invalid={problem !== undefined}
            multiline={true}
            wrap={true}
            completions={context.completions(section)}
            onChange={(text) => {
              setDraft(text);
              setProblem(undefined);
            }}
            onCommit={commit}
          />
        </div>
        <ErrorToast message={problem} />
      </div>
    ) : undefined,
  };
}

function SectionCodeToggle(props: { readonly section: LoopSection; readonly on: boolean; readonly onPress: () => void }) {
  const translate = useTranslate();
  const title = translate(SECTION_TITLE_KEYS[props.section]);
  return (
    <button
      type="button"
      className={`prop-expr-toggle${props.on ? ' on' : ''}`}
      title={props.on ? translate('props.loop.section.useControls') : translate('props.loop.section.writeCode')}
      aria-pressed={props.on}
      aria-label={translate('props.loop.section.asCode', { title })}
      onClick={props.onPress}
    >
      <BracesIcon size={12} />
    </button>
  );
}
