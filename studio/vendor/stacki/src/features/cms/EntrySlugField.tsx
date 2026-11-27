import { useContext, useEffect, useState } from 'react';
import { checkEntrySlug, ENTRY_SLUG_LIMITS, slugNote, slugProblem, type EntrySlug } from '../../../shared/properties/entrySlug';
import { reportErrorToast } from '../../ui/errorNotices';
import { TagIcon } from '../../ui/Icons';
import { CmsFieldFrame } from './CmsPropField';
import { committable } from './entrySlugDraft';
import { FieldChecksContext } from './remoteCmsShared';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';

export function EntrySlugField(props: {
  readonly slug: EntrySlug;
  readonly text?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly onType?: ((text: string) => void) | undefined;
  readonly onCommit: (slug: string) => void;
}) {
  const { slug } = props;
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const slugHelp = translate('cms.slug.help');
  const slugName = translate('cms.slug.name');
  const checks = useContext(FieldChecksContext);
  const [typed, setTyped] = useState(slug.value);
  useEffect(() => setTyped(slug.value), [slug.value]);
  const text = props.text ?? typed;
  if (slug.rename.kind === 'locked') {
    const lockedReason = translateDescribed({ message: slug.rename.reason, messageRef: slug.rename.reasonRef });
    return (
      <div className="remote-cms-field entry-slug-field" data-kind="slug">
        <CmsFieldFrame name={slugName} help={`${slugHelp} ${lockedReason}`} icon={<TagIcon size={12} />} set={slug.value !== ''}>
          <div className="remote-cms-locked">{`${slug.folder}${slug.value}`}</div>
        </CmsFieldFrame>
      </div>
    );
  }
  const check = checkEntrySlug(text, { taken: slug.taken });
  const blank = text === '' && props.placeholder !== undefined;
  const problem = blank || checks === 'held' ? undefined : slugProblem(check, translate);
  const note = slugNote(check, translate);
  const type = (next: string) => {
    setTyped(next);
    props.onType?.(next);
  };
  const commit = () => {
    const slugged = committable(check, slug.value);
    if (slugged !== undefined) {
      props.onCommit(slugged);
    } else if (problem !== undefined) {
      reportErrorToast(problem);
    }
  };
  return (
    <div className={`remote-cms-field entry-slug-field is-required${problem === undefined ? '' : ' is-invalid'}`} data-kind="slug">
      <CmsFieldFrame name={slugName} help={note === undefined ? slugHelp : `${slugHelp} ${note}`} icon={<TagIcon size={12} />} set={text !== ''}>
        <div className="entry-slug-input">
          {slug.folder !== '' && <span className="entry-slug-folder">{slug.folder}</span>}
          <input
            value={text}
            type="text"
            spellCheck={false}
            aria-invalid={problem !== undefined}
            placeholder={props.placeholder}
            maxLength={ENTRY_SLUG_LIMITS.charsMax * 2}
            onChange={(event) => type(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'Escape') {
                type(slug.value);
              }
            }}
          />
        </div>
      </CmsFieldFrame>
    </div>
  );
}
