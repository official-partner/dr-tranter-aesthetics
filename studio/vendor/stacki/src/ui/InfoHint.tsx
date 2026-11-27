import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { assert } from '../../shared/core/assert';
import { useTranslate } from '../lib/i18n/useTranslate';
import { centralIcon } from './central/CentralIcon';
import { info as centralInfo } from './central/centralGeometry';
import { tooltipAnchor, tooltipHost, useDelayedPlacement, type TooltipAnchor } from './delayedTooltip';
import FittedTooltip from './FittedTooltip';
import './infoHint.css';

const InfoIcon = centralIcon(centralInfo, 12);

export default function InfoHint({ text }: { readonly text: string }) {
  assert(text.length > 0, 'InfoHint: the explanation is not empty');
  const translate = useTranslate();
  const descriptionId = useId();
  const tip = useDelayedPlacement(measureAnchor);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="settings-info"
        aria-label={translate('settings.info.label')}
        aria-describedby={descriptionId}
        title=""
        onMouseEnter={(event) => tip.show(event.currentTarget)}
        onMouseLeave={tip.hide}
        onFocus={(event) => tip.showNow(event.currentTarget)}
        onBlur={tip.hide}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && tip.value !== undefined) {
            event.stopPropagation();
            tip.hide();
          }
        }}
      >
        <InfoIcon />
      </button>
      <span id={descriptionId} className="info-hint-text">
        {text}
      </span>
      {tip.value !== undefined &&
        createPortal(
          <FittedTooltip className="settings-info-tip" role="tooltip" hidden anchor={tip.value}>
            {text}
          </FittedTooltip>,
          tooltipHost(button.current ?? undefined),
        )}
    </>
  );
}

function measureAnchor(element: HTMLElement): TooltipAnchor {
  return tooltipAnchor(element.getBoundingClientRect());
}
