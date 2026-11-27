import { useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { assert } from '../../../shared/core/assert';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { tooltipHost, tooltipAnchor, useDelayedTooltip, type TooltipAnchor } from '../../ui/delayedTooltip';
import FittedTooltip from '../../ui/FittedTooltip';
import { HelpCircleIcon } from '../../ui/Icons';
import './appDetails.css';

type SectionHeading = { readonly title: string; readonly hint?: string } | { readonly label: string };

export function AppDetailsSection(props: SectionHeading & { readonly children: ReactNode }) {
  const id = useId();
  if ('title' in props) {
    assert(props.title.length > 0, 'A details section has a title');
    return (
      <section className="apps-details-section" aria-labelledby={id}>
        <header className="apps-details-section-header">
          <h4 id={id}>{props.title}</h4>
          {props.hint !== undefined && <AppDetailsHint label={props.title} text={props.hint} />}
        </header>
        {props.children}
      </section>
    );
  }
  assert(props.label.length > 0, 'A details section without a heading still has a name');
  return (
    <section className="apps-details-section" aria-label={props.label}>
      {props.children}
    </section>
  );
}

export function AppDetailsList(props: { readonly label?: string; readonly children: ReactNode }) {
  return (
    <ul className="apps-details-list" aria-label={props.label}>
      {props.children}
    </ul>
  );
}

export function AppDetailsItem(props: {
  readonly label: ReactNode;
  readonly title?: string;
  readonly hint?: string;
  readonly tone?: 'warning';
  readonly children?: ReactNode;
}) {
  const translate = useTranslate();
  const title = props.title ?? (typeof props.label === 'string' ? props.label : undefined);
  return (
    <li className="apps-details-item" data-tone={props.tone}>
      <span className="apps-details-item-label">
        {props.tone === 'warning' && <span className="apps-details-dot" aria-hidden="true" />}
        <span className="apps-details-item-text" title={title}>
          {props.label}
        </span>
        {props.hint !== undefined && <AppDetailsHint label={title ?? translate('apps.details.thisRow')} text={props.hint} />}
      </span>
      {props.children !== undefined && <span className="apps-details-item-value">{props.children}</span>}
    </li>
  );
}

export function AppDetailsRow(props: {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly descriptionId?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="apps-details-row">
      <div className="apps-details-row-text">
        <span className="apps-details-row-label">{props.label}</span>
        {props.description !== undefined && (
          <p className="apps-details-row-description" id={props.descriptionId}>
            {props.description}
          </p>
        )}
      </div>
      {props.children !== undefined && <div className="apps-details-row-control">{props.children}</div>}
    </div>
  );
}

export function AppDetailsHint({ label, text }: { readonly label: string; readonly text: string }) {
  assert(label.length > 0, 'A hint names what it explains');
  assert(text.length > 0, 'A hint has something to say');
  const translate = useTranslate();
  const id = useId();
  const tooltip = useDelayedTooltip();
  const hintButton = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState<TooltipAnchor | undefined>(undefined);
  const shown = focused ?? tooltip.value;
  return (
    <>
      <button
        ref={hintButton}
        type="button"
        className="apps-details-hint"
        aria-label={translate('apps.details.aboutNamed', { name: label })}
        aria-describedby={id}
        onMouseEnter={(event: MouseEvent<HTMLElement>) => tooltip.show(event)}
        onMouseLeave={tooltip.hide}
        onFocus={(event: FocusEvent<HTMLElement>) => setFocused(tooltipAnchor(event.currentTarget.getBoundingClientRect()))}
        onBlur={() => setFocused(undefined)}
      >
        <HelpCircleIcon size={12} />
      </button>
      <span id={id} className="apps-details-hint-text">
        {text}
      </span>
      {shown !== undefined &&
        createPortal(
          <FittedTooltip className="apps-details-tip" role="tooltip" anchor={shown}>
            {text}
          </FittedTooltip>,
          tooltipHost(hintButton.current ?? undefined),
        )}
    </>
  );
}
