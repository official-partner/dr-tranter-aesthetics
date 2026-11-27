import { centralIcon } from '../../ui/central/CentralIcon';
import { code as centralCode } from '../../ui/central/centralGeometry';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { tooltipHost, useDelayedTooltip } from '../../ui/delayedTooltip';
import FittedTooltip from '../../ui/FittedTooltip';
import type { Contributor } from './model/resolved';
import { withImportant } from './model/styleDisplay';
import { useTranslate } from '../../lib/i18n/useTranslate';

const WEBFLOW_BRAND = 'Webflow';

export type EmbedNav = {
  open: (embedKey: string) => void;
  labelFor: (embedKey: string) => string;
};
export const ProvenanceEmbedNav = createContext<EmbedNav | undefined>(undefined);

const EmbedGlyph = centralIcon(centralCode, 12);

export default function ProvenanceList({
  contributors,
  prop,
  onSelect,
}: {
  contributors: Contributor[];
  prop?: string;
  onSelect?: (selectorText: string, prop?: string) => void;
}) {
  const nav = useContext(ProvenanceEmbedNav);
  if (!contributors.length) {
    return undefined;
  }
  const editingIndex = contributors.findIndex((contributor) => contributor.editing);
  const activeIndex = editingIndex >= 0 ? editingIndex : contributors.findIndex((contributor) => contributor.winning);
  return (
    <ul className="embed-editor_provenance-list">
      {contributors.map((contributor, index) => (
        <ProvenanceItem
          key={index}
          contributor={contributor}
          active={index === activeIndex}
          winner={contributors.find((candidate) => candidate.winning)}
          nav={nav}
          prop={prop}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function lossTip(contributor: Contributor, winner: Contributor | undefined, translate: ReturnType<typeof useTranslate>): string | undefined {
  if (contributor.origin === 'browser') {
    return translate('style.provenanceList.usedValueTip');
  }
  if (contributor.lossReason === undefined) {
    return undefined;
  }
  const selector = winner === undefined ? '' : (winner.display ?? winner.selectorText);
  return translate(`style.provenanceList.loss.${contributor.lossReason}`, { selector });
}

function ProvenanceItem({
  contributor,
  active,
  winner,
  nav,
  prop,
  onSelect,
}: {
  readonly contributor: Contributor;
  readonly active: boolean;
  readonly winner: Contributor | undefined;
  readonly nav: EmbedNav | undefined;
  readonly prop: string | undefined;
  readonly onSelect: ((selectorText: string, prop?: string) => void) | undefined;
}) {
  const translate = useTranslate();
  const tooltip = useDelayedTooltip();
  const className = `embed-editor_provenance-item ${active ? 'is-active' : ''}`;
  const rawValue = withImportant(contributor);
  const tip = lossTip(contributor, winner, translate);
  const browserLabel =
    contributor.display === undefined
      ? translate('style.provenanceList.usedValue')
      : translate('style.provenanceList.usedValueIn', { condition: contributor.display });
  const body = (
    <>
      <ProvenanceOrigin contributor={contributor} nav={nav} />
      <div className="embed-editor_provenance-line">
        {contributor.origin === 'browser' ? (
          <span className="embed-editor_provenance-sel">{browserLabel}</span>
        ) : (
          <code className="embed-editor_provenance-sel">{contributor.display ?? contributor.selectorText}</code>
        )}
        <span className="embed-editor_provenance-val" title={rawValue}>
          {rawValue}
        </span>
      </div>
    </>
  );
  const select = contributor.editing || contributor.origin === 'browser' ? undefined : onSelect;
  return (
    <li onMouseEnter={tip === undefined ? undefined : tooltip.show} onMouseLeave={tooltip.hide}>
      {select ? (
        <button
          type="button"
          className={`${className} is-clickable`}
          {...(tip === undefined ? { title: translate('style.provenanceList.edit', { selector: contributor.selectorText }) } : {})}
          onClick={() => select(contributor.selectorText, prop)}
        >
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
      {tip !== undefined &&
        tooltip.value !== undefined &&
        createPortal(
          <FittedTooltip role="tooltip" anchor={tooltip.value}>
            {tip}
          </FittedTooltip>,
          tooltipHost(undefined),
        )}
    </li>
  );
}

function ProvenanceOrigin({ contributor, nav }: { contributor: Contributor; nav: EmbedNav | undefined }) {
  const translate = useTranslate();
  if (contributor.origin === 'native') {
    return <span className="embed-editor_provenance-origin">{WEBFLOW_BRAND}</span>;
  }
  if (contributor.origin === 'inline') {
    return <span className="embed-editor_provenance-origin">{translate('style.provenanceList.styleAttribute')}</span>;
  }
  const embedKey = contributor.embedKey;
  if (!embedKey || !nav) {
    return undefined;
  }
  const embedName = nav.labelFor(embedKey);
  if (!embedName) {
    return undefined;
  }
  const componentClass = contributor.fromComponent ? 'is-component' : '';
  return (
    <span
      className={`embed-editor_provenance-embed ${componentClass}`}
      role="button"
      title={translate('style.provenanceList.selectOnCanvas', { name: embedName })}
      onClick={(event) => {
        event.stopPropagation();
        nav.open(embedKey);
      }}
    >
      <EmbedGlyph className="embed-editor_provenance-embed-icon" />
      <span className="embed-editor_provenance-embed-label">{embedName}</span>
    </span>
  );
}
