
import { createPortal } from 'react-dom';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { centralIcon } from '../../ui/central/CentralIcon';
import { placeholder as centralPlaceholder } from '../../ui/central/centralGeometry';
import { tooltipHost, useDelayedTooltip } from '../../ui/delayedTooltip';
import { HideIcon, PointerEventsNoneIcon } from '../../ui/Icons';
import type { NavigatorNode } from './structureModel';

const RendersNothingIcon = centralIcon(centralPlaceholder, 12);

const NEVER_RENDERED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'link', 'meta', 'title', 'base', 'template', 'noscript']);

const NEVER_RENDERED_KINDS: ReadonlySet<string> = new Set(['raw', 'comment', 'frontmatter']);

export function drawsOnCanvas(node: NavigatorNode): boolean {
  if (NEVER_RENDERED_KINDS.has(node.kind)) {
    return false;
  }
  if (node.kind === 'element' && 'name' in node) {
    return !NEVER_RENDERED_TAGS.has(node.name.toLowerCase());
  }
  return true;
}

export interface NodeStatusProps {
  readonly node: NavigatorNode;
  readonly rendersNothing: boolean;
  readonly hidden: boolean;
  readonly inert: boolean;
}

export default function NodeStatus({ node, rendersNothing, hidden, inert }: NodeStatusProps) {
  const translate = useTranslate();
  const reportable = drawsOnCanvas(node);
  const showEmpty = reportable && rendersNothing;
  const showHidden = reportable && hidden && !rendersNothing;
  const showInert = reportable && inert;
  if (!showEmpty && !showHidden && !showInert) {
    return undefined;
  }
  return (
    <span className="node-empty">
      {showEmpty && (
        <StatusMark kind="empty" text={translate('structure.status.empty')}>
          <RendersNothingIcon size={12} />
        </StatusMark>
      )}
      {showHidden && (
        <StatusMark kind="hidden" text={translate('structure.status.hidden')}>
          <HideIcon size={12} />
        </StatusMark>
      )}
      {showInert && (
        <StatusMark kind="inert" text={translate('structure.status.inert')}>
          <PointerEventsNoneIcon size={12} />
        </StatusMark>
      )}
    </span>
  );
}

function StatusMark({ kind, text, children }: { readonly kind: 'empty' | 'hidden' | 'inert'; readonly text: string; readonly children: React.ReactNode }) {
  const tooltip = useDelayedTooltip();
  return (
    <>
      <span role="img" aria-label={text} data-status={kind} onMouseEnter={tooltip.show} onMouseLeave={tooltip.hide}>
        {children}
      </span>
      {tooltip.value !== undefined &&
        createPortal(
          <div className="rail-tooltip below" role="tooltip" style={tooltip.value}>
            {text}
          </div>,
          tooltipHost(undefined),
        )}
    </>
  );
}
