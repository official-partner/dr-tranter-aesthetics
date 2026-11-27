import { useTranslate } from '../../../lib/i18n/useTranslate';
import { centralIcon } from '../../../ui/central/CentralIcon';
import {
  add as centralAdd,
  check as centralCheck,
  circle as centralCircle,
  code as centralCode,
  studioDisplay as centralStudioDisplay,
  edit as centralEdit,
  phone as centralPhone,
  spinner as centralSpinner,
  tablet as centralTablet,
} from '../../../ui/central/centralGeometry';
import { ErrorToast } from '../../../ui/ErrorToast';
import { ComponentFillIcon } from '../../../ui/Icons';
import type { IconProps } from '../../../ui/IconBase';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { type RuleModel } from '../model/cascade';
import { STATES, type ResolvedStyle } from '../model/resolved';
import type { AtRule } from 'postcss';
import { listAtRuleBlocks } from '../model/css';
import { webflowClassToCss, type EmbedDocument } from '../model/webflow';
import type { BreakpointId, ElementSnapshot } from '../model/styleTypes';

export type ScanState = {
  rootSnapshot: ElementSnapshot | undefined;
  model: RuleModel;
  placeholders: Placeholder[];
  embedCount: number;
  componentEmbedCount: number;
  rememberedPageEmbedCount: number;
  errors: Array<{ label: string; message: string }>;
  inComponentContext: boolean;
  awaitingFirstAnswer: boolean;
  settled: boolean;
};

export type Phase = 'idle' | 'scanning' | 'ready' | 'no-selection' | 'unsupported';

export type WriteSettle = Promise<unknown> | 'until-model' | undefined;
export type SetProp = (prop: string, value: string, important: boolean) => WriteSettle;

export interface PropWrite {
  readonly prop: string;
  readonly value: string;
  readonly important: boolean;
}

export type LiveSetProp = (prop: string | readonly string[], value: string | undefined, important: boolean) => void;

export const EMPTY_RESOLVED: ResolvedStyle = {
  props: new Map(),
  selectedRule: undefined,
  selectedRules: new Map(),
  contexts: [],
  states: STATES,
};
export const EMPTY_RULE_MODEL: RuleModel = { base: [], conditional: [], matchedRuleCount: 0 };


export function standaloneNativeClass(selector: string): string | undefined {
  const match = selector.trim().match(/^\.([_a-z-][\w-]*)(?::(?:hover|focus|active))?$/i);
  return match ? webflowClassToCss(match[1] ?? '') : undefined;
}


export type Placeholder = {
  key: string;
  atContext: string[];
  selector: string;
  embedKey: string;
  atRuleNode: AtRule;
};

export function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim();
}

export function computePlaceholders(docs: EmbedDocument[], classList: string[]): Placeholder[] {
  if (!classList.length) {
    return [];
  }
  const primary = `.${classList[0]}`;
  const full = `.${classList.join('.')}`;
  const candidates = full === primary ? [primary] : [primary, full];

  const out: Placeholder[] = [];
  for (const embedDocument of docs) {
    embedDocument.regions.forEach((region, regionIndex) => {
      for (const block of listAtRuleBlocks(region)) {
        const existing = new Set(block.selectors.map(normalizeSelector));
        for (const selector of candidates) {
          if (existing.has(normalizeSelector(selector))) {
            continue;
          }
          out.push({
            key: `${embedDocument.source.key}:${regionIndex}:` + `${block.atContext.join('>')}:${selector}`,
            atContext: block.atContext,
            selector,
            embedKey: embedDocument.source.key,
            atRuleNode: block.node,
          });
        }
      }
    });
  }
  return out;
}


export const PencilIcon = centralIcon(centralEdit);
export const EMBED_ICON_SECOND_PATH = 'M6.35352 6.85352L5.20703 8L6.35352 9.14648L5.64648 9.85352L3.79297 8L5.64648 6.14648' + 'L6.35352 6.85352Z';
export const EMBED_ICON_THIRD_PATH = 'M12.207 8L10.3535 9.85352L9.64648 9.14648L10.793 8L9.64648 6.85352L10.3535 6.14648' + 'L12.207 8Z';
export const EMBED_ICON_FOURTH_PATH =
  'M13 2C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13' + 'V3C2 2.44772 2.44772 2 3 2H13ZM3 13H13V3H3V13Z';

export const EmbedIcon = centralIcon(centralCode);
export const CreateStyleTagIcon = centralIcon(centralAdd);

export const COMPONENT_ICON_PATH =
  'M8.47885 1.69144C8.18037 1.52863 7.81963 1.52863 7.52115 1.69144L2.52115 4.41871' +
  'C2.19989 4.59395 2 4.93066 2 5.29661V10.703C2 11.0689 2.19989 11.4056 2.52115 11.5809' +
  'L7.52115 14.3081C7.81963 14.471 8.18037 14.471 8.47885 14.3081L13.4789 11.5809' +
  'C13.8001 11.4056 14 11.0689 14 10.703V5.29661C14 4.93066 13.8001 4.59395 13.4789 4.41871' +
  'L8.47885 1.69144ZM3.54416 4.99979L8 2.56934L12.4558 4.99979L8 7.43025L3.54416 4.99979Z' +
  'M3 5.84206L3 10.703L7.5 13.1575V8.29661L3 5.84206ZM8.5 13.1575L13 10.703V5.84206' +
  'L8.5 8.29661V13.1575Z';

export function ComponentIcon({ size = 16, ...rest }: IconProps) {
  return <ComponentFillIcon size={size} {...rest} />;
}

export const SpinnerIcon = centralIcon(centralSpinner);
export const CheckIcon = centralIcon(centralCheck);
export const UnsavedIcon = centralIcon(centralCircle, 12);
export function SaveIndicator({ busy, error, pending }: { busy: boolean; error: string | undefined; pending: string | undefined }) {
  const translate = useTranslate();
  const [target, setTarget] = useState<HTMLElement | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs every render on purpose
  useEffect(() => {
    const slot = document.getElementById('embed-editor_save-slot') ?? undefined;
    setTarget((previous) => (previous === slot ? previous : slot));
  });
  if (!target) {
    return undefined;
  }
  const state = busy
    ? { cls: 'is-saving', tip: translate('styleModel.embed.save.saving'), icon: <SpinnerIcon /> }
    : error
      ? { cls: 'is-unsaved', tip: translate('styleModel.embed.save.unsaved'), icon: <UnsavedIcon /> }
      : pending
        ? { cls: 'is-unsaved', tip: pending, icon: <UnsavedIcon /> }
        : { cls: 'is-saved', tip: translate('styleModel.embed.save.saved'), icon: <CheckIcon /> };
  const node = (
    <span className={`embed-editor_save ${state.cls}`} tabIndex={0} aria-label={state.tip}>
      {state.icon}
      <span className="embed-editor_tip" role="tooltip">
        {state.tip}
      </span>
    </span>
  );
  return (
    <>
      <ErrorToast message={error} />
      {createPortal(node, target)}
    </>
  );
}

export const TabletBreakpointIcon = centralIcon(centralTablet);
export const MobileBreakpointIcon = centralIcon(centralPhone);
export function MobileLandscapeBreakpointIcon() {
  return <MobileBreakpointIcon style={{ transform: 'rotate(90deg)' }} />;
}
export const DesktopBreakpointIcon = centralIcon(centralStudioDisplay);
export function breakpointIcon(id: BreakpointId | undefined): ReactNode {
  switch (id) {
    case 'main':
      return <DesktopBreakpointIcon />;
    case 'medium':
      return <TabletBreakpointIcon />;
    case 'small':
      return <MobileLandscapeBreakpointIcon />;
    case 'tiny':
      return <MobileBreakpointIcon />;
    case 'xxl':
    case 'xl':
    case 'large':
    case undefined:
      return undefined;
  }
}
