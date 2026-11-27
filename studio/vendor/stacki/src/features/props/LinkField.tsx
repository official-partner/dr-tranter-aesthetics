import { useTranslate, useTranslateRich } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Attr } from '../../../shared/page/pageNode';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import Dropdown from '../../ui/Dropdown';
import AssetField from '../../ui/AssetField';
import { ElementLinkIcon, FileIcon, PhoneIcon, ElementImageIcon } from '../../ui/Icons';
import LinkPageChooser from './LinkPageChooser';
import type { LinkEntryLoader } from './linkEntries';
import { anchorTargetExists, detectLinkType, type LinkPage, type LinkType, type LinkTypeContext } from './linkType';


const TYPES: ReadonlyArray<{ readonly id: LinkType; readonly title: MessageKey; readonly icon: React.ReactNode }> = [
  { id: 'url', title: 'props.link.type.url', icon: <ElementLinkIcon size={13} /> },
  { id: 'page', title: 'props.link.type.page', icon: <FileIcon size={13} /> },
  { id: 'section', title: 'props.link.type.section', icon: <b style={{ fontSize: 12 }}>#</b> },
  { id: 'email', title: 'props.link.type.email', icon: <b style={{ fontSize: 12 }}>@</b> },
  { id: 'phone', title: 'props.link.type.phone', icon: <PhoneIcon size={13} /> },
  { id: 'asset', title: 'props.link.type.asset', icon: <ElementImageIcon size={13} /> },
];

function parseMailto(text: string) {
  const match = String(text).match(/^mailto:([^?]*)(?:\?(.*))?$/);
  if (!match) {
    return { email: '', subject: '' };
  }
  let subject = '';
  try {
    subject = new URLSearchParams(match[2] || '').get('subject') || '';
  } catch {
  }
  return { email: match[1] || '', subject };
}

interface LinkContext {
  readonly pages?: readonly LinkPage[];
  readonly sectionIds?: readonly string[];
  readonly loadEntries?: LinkEntryLoader | undefined;
  readonly projectPath: string;
}
interface LinkFieldProps {
  readonly value?: Attr | undefined;
  readonly context: LinkContext;
  readonly placeholder?: string | undefined;
  readonly onChange: (value: Attr, immediate?: boolean) => void;
}
function linkTypeContext(context: LinkContext): LinkTypeContext {
  return { routes: (context.pages ?? []).map((page) => page.route), sectionIds: context.sectionIds ?? [] };
}

const NO_PAGES: readonly LinkPage[] = [];

type Commit = (value: string, options?: { readonly immediate: boolean }) => void;
export default function LinkField({ value, context, placeholder, onChange }: LinkFieldProps) {
  const text = value?.type === 'string' ? value.value : '';
  assert((context.pages?.length ?? 0) <= LIMITS.scanEntriesMax, 'LinkField: page limit exceeded');
  assert((context.sectionIds?.length ?? 0) <= LIMITS.treeNodesMax, 'LinkField: section limit exceeded');
  const [type, setType] = useState(() => detectLinkType(text, linkTypeContext(context)));
  const lastRef = useRef(text);
  useEffect(() => {
    if (text !== lastRef.current) {
      setType(detectLinkType(text, linkTypeContext(context)));
      lastRef.current = text;
    }
  }, [text, context]);
  const commit: Commit = (next, options) => {
    lastRef.current = next;
    onChange({ type: 'string', value: next }, options?.immediate ?? false);
  };
  return (
    <>
      <LinkTypes type={type} setType={setType} />
      <LinkControl
        type={type}
        text={text}
        context={context}
        placeholder={placeholder === undefined || placeholder === '' ? '#' : placeholder}
        commit={commit}
      />
    </>
  );
}

function LinkControl({
  type,
  text,
  context,
  placeholder,
  commit,
}: {
  readonly type: LinkType;
  readonly text: string;
  readonly context: LinkContext;
  readonly placeholder: string;
  readonly commit: Commit;
}) {
  const translate = useTranslate();
  switch (type) {
    case 'url':
      return <input value={text} placeholder={placeholder} spellCheck={false} onChange={(event) => commit(event.target.value)} />;
    case 'page':
      return (
        <LinkPageChooser
          text={text}
          pages={context.pages ?? NO_PAGES}
          loadEntries={context.loadEntries}
          onPick={(route) => commit(route, { immediate: true })}
        />
      );
    case 'section':
      return <LinkSection text={text} sections={context.sectionIds ?? []} commit={commit} />;
    case 'email':
      return <LinkEmail text={text} commit={commit} />;
    case 'phone':
      return (
        <input
          value={text.startsWith('tel:') ? text.slice(4) : ''}
          placeholder={translate('props.link.examplePhone')}
          spellCheck={false}
          onChange={(event) => commit(`tel:${event.target.value.replace(/\s+/g, '')}`)}
        />
      );
    case 'asset':
      return (
        <AssetField
          value={detectLinkType(text, linkTypeContext(context)) === 'asset' ? text : ''}
          mediaKind="asset"
          projectPath={context.projectPath}
          showModeToggle={false}
          onChange={(value, immediate) => commit(value || '', { immediate: immediate ?? false })}
        />
      );
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function LinkSection({ text, sections, commit }: { readonly text: string; readonly sections: readonly string[]; readonly commit: Commit }) {
  const translate = useTranslate();
  const translateRich = useTranslateRich();
  if (sections.length > 0) {
    return (
      <Dropdown
        value={anchorTargetExists(text, sections) ? text : ''}
        placeholder={translate('props.link.chooseSection')}
        options={sections.map((id) => ({ value: `#${id}`, label: `#${id}` }))}
        onChange={(value) => commit(value, { immediate: true })}
      />
    );
  }
  return <div className="link-note">{translateRich('props.link.noSections', { code: (text) => <code>{text}</code> })}</div>;
}

function LinkEmail({ text, commit }: { readonly text: string; readonly commit: Commit }) {
  const translate = useTranslate();
  const { email, subject } = parseMailto(text);
  return (
    <>
      <input
        value={email}
        placeholder={translate('props.link.exampleEmail')}
        spellCheck={false}
        onChange={(event) => commit(`mailto:${event.target.value.trim()}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`)}
      />
      <input
        value={subject}
        placeholder={translate('props.link.subject')}
        onChange={(event) => commit(`mailto:${email}${event.target.value ? `?subject=${encodeURIComponent(event.target.value)}` : ''}`)}
      />
    </>
  );
}

function LinkTypes({ type, setType }: { readonly type: LinkType; readonly setType: (type: LinkType) => void }) {
  const translate = useTranslate();
  const { rowRef, btnRefs: buttonRefs, indicator } = useLinkIndicator(type);
  return (
    <div className="link-types" ref={rowRef}>
      {indicator && <span className="link-types-indicator" style={indicator} />}
      {TYPES.map((option) => (
        <button
          key={option.id}
          ref={(element) => {
            buttonRefs.current[option.id] = element ?? undefined;
          }}
          type="button"
          className={type === option.id ? 'on' : ''}
          title={translate(option.title)}
          onClick={() => setType(option.id)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

function useLinkIndicator(type: LinkType) {
  const rowRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | undefined>>({});
  const typeRef = useRef(type);
  typeRef.current = type;
  const [indicator, setIndicator] = useState<
    | {
        readonly left: number;
        readonly width: number;
      }
    | undefined
  >(undefined);
  const measure = () => {
    const element = buttonRefs.current[typeRef.current];
    const next = element && element.offsetWidth ? { left: element.offsetLeft, width: element.offsetWidth } : undefined;
    setIndicator((previous) => (previous && next && previous.left === next.left && previous.width === next.width ? previous : next));
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    if (!rowRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const ro = new ResizeObserver(measure);
    ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, []);

  return { rowRef, btnRefs: buttonRefs, indicator };
}
