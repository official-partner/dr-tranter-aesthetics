import { useEffect, useMemo, useState } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import Dropdown, { type DropdownOption } from '../../ui/Dropdown';
import { CmsIcon, FileIcon } from '../../ui/Icons';
import { linkChoices, LINK_ROWS_DRAWN_MAX, templatesToLoad, type LinkChoice, type LinkEntryLoader, type LinkTemplateState } from './linkEntries';
import type { LinkPage } from './linkType';


interface LinkPageChooserProps {
  readonly text: string;
  readonly pages: readonly LinkPage[];
  readonly loadEntries?: LinkEntryLoader | undefined;
  readonly onPick: (route: string) => void;
}

export default function LinkPageChooser({ text, pages, loadEntries, onPick }: LinkPageChooserProps) {
  const translate = useTranslate();
  const states = useTemplateStates(pages, loadEntries);
  const options = useMemo(() => linkChoices(pages, states, text, translate), [pages, states, text, translate]);
  const loading = [...states.values()].some((state) => state.kind === 'loading');
  return (
    <Dropdown
      value={options.some((option) => option.value === text) ? text : ''}
      placeholder={translate('props.link.choosePage')}
      optionLayout="stacked"
      options={options.map(linkChoiceOption)}
      searchable
      searchPlaceholder={translate('props.link.searchPages')}
      rowsMax={LINK_ROWS_DRAWN_MAX}
      loading={loading}
      livePreview={false}
      onChange={onPick}
    />
  );
}

function linkChoiceOption({ source, ...option }: LinkChoice): DropdownOption<string> {
  switch (source) {
    case 'page':
      return { ...option, icon: <FileIcon size={12} /> };
    case 'cms':
      return { ...option, icon: <CmsIcon size={12} />, tone: 'collection' };
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function useTemplateStates(pages: readonly LinkPage[], loadEntries: LinkEntryLoader | undefined): ReadonlyMap<string, LinkTemplateState> {
  const [states, setStates] = useState<ReadonlyMap<string, LinkTemplateState>>(() => new Map());
  const routesKey = templatesToLoad(pages).join('\n');
  useEffect(() => {
    const routes = routesKey.length === 0 ? [] : routesKey.split('\n');
    if (loadEntries === undefined || routes.length === 0) {
      setStates(new Map());
      return undefined;
    }
    let live = true;
    setStates(new Map(routes.map((route) => [route, { kind: 'loading' } as const])));
    void (async () => {
      for (const route of routes) {
        const resolved = await loadEntries(route);
        if (!live) {
          return;
        }
        setStates((previous) => new Map(previous).set(route, resolved));
      }
    })();
    return () => {
      live = false;
    };
  }, [routesKey, loadEntries]);
  return states;
}
