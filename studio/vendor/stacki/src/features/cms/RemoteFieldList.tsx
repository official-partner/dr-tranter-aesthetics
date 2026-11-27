import { useLayoutEffect, useRef, useState } from 'react';
import type { RemoteDocument, RemoteDocumentField, RemoteFieldGroup } from '../../../shared/properties/cmsRemote';
import type { RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import { assert } from '../../../shared/core/assert';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { SyncIcon } from '../../ui/Icons';
import { RemoteFieldInput } from './RemoteFieldInput';
import type { RemoteEditContext } from './RemoteValueEditor';
import { slugInStep, slugify, slugPairOf, slugValue, type SlugPair } from './slugSync';

export function RemoteFieldList(props: {
  readonly document: RemoteDocument;
  readonly context: RemoteEditContext;
  readonly requiredShown?: ReadonlySet<string> | undefined;
  readonly onSave: (field: RemoteDocumentField, value: RemoteValue | undefined) => void;
}) {
  const { document } = props;
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const tab = shownTab(document.fieldGroups, chosen);
  return (
    <>
      {document.fieldGroups !== undefined && <FieldGroupTabs fieldGroups={document.fieldGroups} tab={tab} onTab={setChosen} />}
      <DocumentFields {...props} key={document.id} tab={tab} />
    </>
  );
}

function DocumentFields(props: {
  readonly document: RemoteDocument;
  readonly context: RemoteEditContext;
  readonly requiredShown?: ReadonlySet<string> | undefined;
  readonly tab: string;
  readonly onSave: (field: RemoteDocumentField, value: RemoteValue | undefined) => void;
}) {
  const { document, tab } = props;
  const translate = useTranslate();
  const pair = slugPairOf(document.fields);
  const sync = useSlugSync(document, pair);
  const fields = tab === ALL_FIELDS ? document.fields : document.fields.filter((field) => field.groups?.includes(tab) === true);
  return fields.map((field) => {
    const input = (
      <RemoteFieldInput
        key={`${document.id}:${field.name}`}
        field={field}
        context={props.context}
        follow={field.name === pair?.slug ? sync.follow : undefined}
        onDraft={field.name === pair?.source ? sync.nameTyped : undefined}
        requiredShown={props.requiredShown?.has(field.name) === true}
        onSave={(value) => props.onSave(field, value)}
      />
    );
    if (field.name !== pair?.slug) {
      return input;
    }
    return (
      <div key={`${document.id}:${field.name}`} className="remote-cms-slug-sync">
        {input}
        <button
          type="button"
          className={`remote-cms-sync${sync.on ? ' on' : ''}`}
          aria-pressed={sync.on}
          title={translate(sync.on ? 'cmsRemote.fieldList.syncOn' : 'cmsRemote.fieldList.syncOff')}
          onClick={sync.toggle}
        >
          <SyncIcon size={12} />
        </button>
      </div>
    );
  });
}

const ALL_FIELDS = 'all-fields';

function shownTab(fieldGroups: readonly RemoteFieldGroup[] | undefined, chosen: string | undefined): string {
  if (fieldGroups === undefined) {
    return ALL_FIELDS;
  }
  if (fieldGroups.some((group) => group.name === chosen)) {
    assert(chosen !== undefined, 'A shown group was chosen');
    return chosen;
  }
  return ALL_FIELDS;
}

interface TabPlace {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function FieldGroupTabs(props: { readonly fieldGroups: readonly RemoteFieldGroup[]; readonly tab: string; readonly onTab: (tab: string) => void }) {
  const translate = useTranslate();
  const tabs = [{ name: ALL_FIELDS, title: translate('cmsRemote.fieldList.allFields') }, ...props.fieldGroups];
  const list = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TabPlace | undefined>(undefined);
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) {
      return undefined;
    }
    const measure = () => {
      const active = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      setPlace(active === null ? undefined : { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.tab]);
  assert(
    tabs.some((group) => group.name === props.tab),
    'The active tab is one of the tabs',
  );
  return (
    <div ref={list} className="remote-cms-groups" role="tablist">
      {}
      {place && (
        <span
          className="remote-cms-groups-mark"
          aria-hidden="true"
          style={{ width: place.width, height: place.height, transform: `translate(${place.left}px, ${place.top}px)` }}
        />
      )}
      {tabs.map((group) => (
        <button key={group.name} type="button" role="tab" aria-selected={group.name === props.tab} onClick={() => props.onTab(group.name)}>
          {group.title}
        </button>
      ))}
    </div>
  );
}

function useSlugSync(document: RemoteDocument, pair: SlugPair | undefined) {
  const valueOf = (name: string | undefined) => document.fields.find((field) => field.name === name)?.value;
  const [on, setOn] = useState(() => (pair === undefined ? false : slugInStep(valueOf(pair.source), valueOf(pair.slug))));
  const [follow, setFollow] = useState<{ readonly value: RemoteValue | undefined }>();
  const name = useRef(valueOf(pair?.source));
  const follows = (text: RemoteValue | undefined) => setFollow({ value: slugValue(slugify(typeof text === 'string' ? text : '')) });
  return {
    on,
    follow: on ? follow : undefined,
    nameTyped: (value: RemoteValue | undefined) => {
      name.current = value;
      if (on) {
        follows(value);
      }
    },
    toggle: () => {
      if (!on) {
        follows(name.current);
      }
      setOn(!on);
    },
  };
}
