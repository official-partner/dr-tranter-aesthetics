import { useRef, type ReactNode } from 'react';
import { assert } from '../../shared/core/assert';
import { segmentIndicatorStyle, useSegmentIndicator } from './segmentIndicator';
import './segmentedTabs.css';

export interface SegmentedTab<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly badge?: string;
  readonly dim?: boolean;
}

const SEGMENTED_TABS_MAX = 16;

export const SEGMENTED_TABS_LAYOUTS = ['content', 'equal'] as const;
export type SegmentedTabsLayout = (typeof SEGMENTED_TABS_LAYOUTS)[number];

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  label,
  layout = 'content',
  className,
  onPick,
}: {
  readonly tabs: readonly SegmentedTab<T>[];
  readonly value: T;
  readonly label: string;
  readonly layout?: SegmentedTabsLayout | undefined;
  readonly className?: { readonly track?: string; readonly indicator?: string; readonly tab?: string };
  readonly onPick: (value: T) => void;
}) {
  assert(tabs.length > 0, 'SegmentedTabs: there is a tab');
  assert(tabs.length <= SEGMENTED_TABS_MAX, 'SegmentedTabs: the tabs fit a row');
  assert(SEGMENTED_TABS_LAYOUTS.includes(layout), 'SegmentedTabs: the layout is a known one');
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | undefined>>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.value === value);
  const { indicator, animated } = useSegmentIndicator({
    trackRef,
    buttonsRef,
    selectedIndex,
    layoutKey: `${layout}:${tabs.map((tab) => `${tab.label}${tab.badge ?? ''}`).join('\u0000')}`,
  });
  const extra = (name: string | undefined): string => (name === undefined ? '' : ` ${name}`);
  return (
    <div ref={trackRef} className={`ui-tabs${layout === 'equal' ? ' is-equal' : ''}${extra(className?.track)}`} role="tablist" aria-label={label}>
      <span
        className={`ui-tabs-indicator${extra(className?.indicator)}${animated ? ' is-animated' : ''}`}
        aria-hidden="true"
        style={segmentIndicatorStyle(indicator)}
      />
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          ref={(element) => {
            buttonsRef.current[index] = element ?? undefined;
          }}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`ui-tab${extra(className?.tab)}${value === tab.value ? ' on' : ''}${tab.dim === true ? ' is-dim' : ''}`}
          onClick={() => onPick(tab.value)}
        >
          {tab.icon}
          {tab.label}
          {tab.badge !== undefined && <span className="ui-tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
