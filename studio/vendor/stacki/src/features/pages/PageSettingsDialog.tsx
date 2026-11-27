import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { assert } from '../../../shared/core/assert';
import type { Result } from '../../../shared/core/result';
import type { Described } from '../../../shared/properties/i18n/messageRef';
import { pageURLPath } from '../../../shared/properties/pageRename';
import {
  checkNewFolder,
  checkUrlName,
  folderOf,
  homeSwapPlan,
  homeSwapRefusalText,
  isHomePage,
  urlNameOf,
  type HomeSwapMoves,
  type PageSettingsRequest,
  type PageSettingsSummary,
} from '../../../shared/properties/pageSettings';
import type { ScanPage } from '../../../shared/properties/projectScan';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { pageDisplayLabel } from '../../lib/pageName';
import { tooltipHost, useDelayedTooltip } from '../../ui/delayedTooltip';
import { CopyIcon, FolderIcon, FolderPlusIcon, HomeIcon, TrashIcon } from '../../ui/Icons';
import { ErrorToast } from '../../ui/ErrorToast';
import { reportErrorToast } from '../../ui/errorNotices';
import Popup from '../../ui/Popup';
import TipAnchor from '../../ui/TipAnchor';
import Dropdown, { popupBox } from '../../ui/Dropdown';
import { SkeletonRows } from '../../ui/Skeleton';
import './pageSettings.css';

export interface PageSettingsHost {
  readonly plan: ((request: PageSettingsRequest) => Promise<Result<PageSettingsSummary>>) | undefined;
  readonly apply: (request: PageSettingsRequest) => Promise<Result<void>>;
  readonly unavailable: Described | undefined;
}

export interface PageSettingsDialogProps {
  readonly page: ScanPage;
  readonly pages: readonly ScanPage[];
  readonly folders: readonly string[];
  readonly host: PageSettingsHost;
  readonly allowed: { readonly rename: boolean; readonly create: boolean; readonly remove: boolean };
  readonly locales?: readonly string[];
  readonly layoutProps?: ReactNode;
  readonly template?: ReactNode;
  readonly close: () => void;
}

type Action =
  | { readonly kind: 'rename'; readonly to: string }
  | { readonly kind: 'home'; readonly moves: HomeSwapMoves }
  | { readonly kind: 'remove' }
  | { readonly kind: 'duplicate' };

type Step =
  | { readonly kind: 'settings' }
  | { readonly kind: 'planning'; readonly action: Action }
  | { readonly kind: 'confirm'; readonly action: Action; readonly summary: PageSettingsSummary }
  | { readonly kind: 'applying'; readonly action: Action };

export function PageSettingsDialog(props: PageSettingsDialogProps) {
  const translate = useTranslate();
  const model = usePageSettings(props);
  const name = pageDisplayLabel(props.page, translate);
  const title = translate('pages.settings.title', { name });
  return (
    <Popup className="modal page-settings" label={title} onClose={props.close} dismissible={!model.busy}>
      {({ close }) => (
        <>
          <div className="page-settings-header">
            <div className="page-settings-heading">
              <div className="page-settings-title">{title}</div>
              <div className="page-settings-route">{props.page.route}</div>
            </div>
            <HeaderActions model={model} props={props} />
            <button type="button" className="page-settings-close" disabled={model.busy} onClick={close}>
              {translate('ui.close')}
            </button>
          </div>
          <div className="page-settings-body">
            {inSections(model.step) ? <SettingsSections model={model} props={props} /> : <ConfirmStep model={model} props={props} />}
            <ErrorToast message={model.problem} />
          </div>
        </>
      )}
    </Popup>
  );
}

type Model = ReturnType<typeof usePageSettings>;

function inSections(step: Step): boolean {
  return step.kind === 'settings' || step.action.kind === 'rename' || step.action.kind === 'home';
}

function usePageSettings(props: PageSettingsDialogProps) {
  const translateDescribed = useTranslateDescribed();
  const [step, setStep] = useState<Step>({ kind: 'settings' });
  const [problem, setProblem] = useState<Described | undefined>(undefined);
  const pending = useRef(false);
  const busy = step.kind === 'planning' || step.kind === 'applying';
  const requestOf = (action: Action): PageSettingsRequest => {
    switch (action.kind) {
      case 'rename':
        return { kind: 'rename', from: props.page.name, to: action.to };
      case 'home':
        return { kind: 'home', page: props.page.name };
      case 'remove':
        return { kind: 'remove', page: props.page.name };
      case 'duplicate':
        return { kind: 'duplicate', page: props.page.name };
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  };
  const apply = async (action: Action): Promise<void> => {
    setStep({ kind: 'applying', action });
    const done = await props.host.apply(requestOf(action));
    if (done.ok) {
      setStep({ kind: 'settings' });
      props.close();
      return;
    }
    setProblem(done.error);
    setStep({ kind: 'settings' });
  };
  const begin = async (action: Action): Promise<void> => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setProblem(undefined);
    try {
      const plan = props.host.plan;
      if (plan === undefined || action.kind === 'duplicate') {
        await apply(action);
        return;
      }
      setStep({ kind: 'planning', action });
      const planned = await plan(requestOf(action));
      if (planned.ok) {
        setStep({ kind: 'confirm', action, summary: planned.value });
      } else {
        setProblem(planned.error);
        setStep({ kind: 'settings' });
      }
    } finally {
      pending.current = false;
    }
  };
  const confirm = async (): Promise<void> => {
    if (step.kind !== 'confirm' || pending.current) {
      return;
    }
    pending.current = true;
    try {
      await apply(step.action);
    } finally {
      pending.current = false;
    }
  };
  return {
    step,
    busy,
    problem: problem === undefined ? undefined : translateDescribed(problem),
    begin,
    confirm,
    cancel: () => setStep({ kind: 'settings' }),
  };
}

function HeaderActions({ model, props }: { readonly model: Model; readonly props: PageSettingsDialogProps }) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const home = isHomePage(props.page.name);
  const unavailable = props.host.unavailable === undefined ? undefined : translateDescribed(props.host.unavailable);
  const deleteReason = home ? translate('pages.settings.delete.homeRefused') : unavailable;
  return (
    <div className="page-settings-actions">
      {props.allowed.create && (
        <TipButton
          label={translate('pages.settings.duplicate')}
          reason={unavailable}
          disabled={model.busy}
          onClick={() => void model.begin({ kind: 'duplicate' })}
        >
          <CopyIcon size={14} />
        </TipButton>
      )}
      {props.allowed.remove && (
        <TipButton label={translate('pages.settings.delete')} reason={deleteReason} disabled={model.busy} onClick={() => void model.begin({ kind: 'remove' })}>
          <TrashIcon size={14} />
        </TipButton>
      )}
    </div>
  );
}

function TipButton(props: {
  readonly label: string;
  readonly reason: string | undefined;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const tooltip = useDelayedTooltip();
  const host = useRef<HTMLSpanElement>(null);
  const tip = props.reason === undefined ? props.label : props.label + ' · ' + props.reason;
  return (
    <span ref={host} className="page-settings-tip" onMouseEnter={tooltip.show} onMouseLeave={tooltip.hide}>
      <button
        type="button"
        className="ghost page-settings-icon"
        aria-label={tip}
        disabled={props.disabled || props.reason !== undefined}
        onClick={props.onClick}
      >
        {props.children}
      </button>
      {tooltip.value !== undefined &&
        createPortal(
          <div className="rail-tooltip below" role="tooltip" style={tooltip.value}>
            {tip}
          </div>,
          tooltipHost(host.current ?? undefined),
        )}
    </span>
  );
}

function SettingsSections({ model, props }: { readonly model: Model; readonly props: PageSettingsDialogProps }) {
  const translate = useTranslate();
  const home = isHomePage(props.page.name);
  return (
    <>
      <section className="page-settings-section">
        <h3>{translate('pages.settings.section.general')}</h3>
        {home ? <HomeBadge /> : <UrlNameField key={props.page.name} model={model} props={props} />}
      </section>
      {props.layoutProps !== undefined && (
        <section className="page-settings-section page-settings-layout">
          <h3>{translate('pages.settings.section.layout')}</h3>
          {props.layoutProps}
        </section>
      )}
      {props.template !== undefined && (
        <section className="page-settings-section">
          <h3>{translate('pages.settings.section.template')}</h3>
          {props.template}
        </section>
      )}
    </>
  );
}

function HomeBadge() {
  const translate = useTranslate();
  return (
    <div className="page-settings-home">
      <TipAnchor text={translate('pages.settings.home.isHome')}>
        <span className="page-settings-badge">
          <HomeIcon size={12} />
          {translate('pages.settings.homeBadge')}
        </span>
      </TipAnchor>
    </div>
  );
}

function UrlNameField({ model, props }: { readonly model: Model; readonly props: PageSettingsDialogProps }) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const id = useId();
  const original = urlNameOf(props.page.name);
  const originalFolder = folderOf(props.page.name);
  const dynamic = props.page.name.includes('[');
  const [name, setName] = useState(original);
  const [folder, setFolder] = useState(originalFolder);
  const [made, setMade] = useState<string | undefined>(undefined);
  const anchor = useRef<HTMLDivElement>(null);
  const justMade = useRef<string | undefined>(undefined);
  const toasted = useRef<string | undefined>(undefined);
  const known = made === undefined ? props.folders : [...props.folders, made];
  const inventory = { pages: props.pages.map((page) => page.name), folders: known };
  const check = (typed: string, chosen: string) => {
    const folders = inventory.folders.includes(chosen) || chosen !== justMade.current ? inventory.folders : [...inventory.folders, chosen];
    return checkUrlName(props.page.name, dynamic ? original : typed, { ...inventory, folders }, { folder: chosen });
  };
  const current = check(name, folder);
  const offer = (typed: string, chosen: string) => {
    const next = check(typed, chosen);
    if (next.kind === 'valid' && props.allowed.rename && !model.busy) {
      void model.begin({ kind: 'rename', to: next.change.to });
    }
    const said = `${typed}\n${chosen}`;
    if (next.kind === 'invalid' && toasted.current !== said) {
      toasted.current = said;
      reportErrorToast(translateDescribed(next.problem));
    }
    if (next.kind === 'valid') {
      toasted.current = undefined;
    }
  };
  const field = (
    <input
      id={id}
      value={dynamic ? original : name}
      readOnly={dynamic}
      maxLength={200}
      spellCheck={false}
      disabled={!props.allowed.rename || model.busy}
      aria-invalid={current.kind === 'invalid'}
      onChange={(event) => setName(event.currentTarget.value)}
      onBlur={() => offer(name, folder)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          offer(name, folder);
        }
      }}
    />
  );
  const revert = () => {
    setName(original);
    setFolder(originalFolder);
    model.cancel();
  };
  const offered = model.step.kind !== 'settings' && model.step.action.kind === 'rename' ? model.step : undefined;
  const folders = [...known].sort((left, right) => left.localeCompare(right));
  const options = [
    { value: '', label: translate('pages.settings.folder.root'), icon: <FolderIcon size={13} /> },
    ...folders.map((entry) => ({ value: entry, label: '/' + entry, icon: <FolderIcon size={13} /> })),
  ];
  return (
    <div className="page-settings-general" ref={anchor}>
      <div className="props-field">
        <label htmlFor={id}>{translate('pages.rename.urlName')}</label>
        {dynamic ? <TipAnchor text={translate('pages.settings.slug.dynamic')}>{field}</TipAnchor> : field}
      </div>
      <div className="props-field">
        <label>{translate('pages.settings.folder')}</label>
        <Dropdown
          className="page-settings-folder"
          ariaLabel={translate('pages.settings.folder')}
          value={folder}
          disabled={!props.allowed.rename || model.busy}
          options={options}
          createRow={{
            label: translate('pages.settings.folder.new'),
            icon: <FolderPlusIcon size={13} />,
            placeholder: translate('pages.settings.folder.placeholder'),
            validate: (text) => {
              const typed = checkNewFolder(text, inventory);
              return typed.kind === 'valid' ? undefined : translateDescribed(typed.problem);
            },
            onCreate: (text) => {
              const typed = checkNewFolder(text, inventory);
              const created = typed.kind === 'valid' ? typed.folder : text.trim();
              justMade.current = created;
              setMade(created);
              return created;
            },
          }}
          onChange={(chosen) => {
            setFolder(chosen);
            if (chosen !== folder) {
              offer(name, chosen);
            }
          }}
        />
        <div className="page-settings-address" aria-label={translate('pages.sample.address') + ': ' + props.page.route}>
          {props.page.route}
        </div>
      </div>
      {!dynamic && (
        <div className="props-field">
          <label>{translate('pages.settings.home.label')}</label>
          <HomeButton model={model} props={props} />
        </div>
      )}
      {offered !== undefined && anchor.current !== null && (
        <StepPopover
          step={offered}
          anchor={anchor.current}
          props={props}
          confirmLabel={translate('pages.settings.move.confirm')}
          confirm={() => void model.confirm()}
          cancel={revert}
        />
      )}
    </div>
  );
}

const STEP_POPOVER_WIDTH_PX = 320;
const STEP_POPOVER_HEIGHT_PX = 280;
const STEP_POPOVER_EDGE_PX = 16;
function stepPopoverPlace(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const leftMax = Math.max(STEP_POPOVER_EDGE_PX, window.innerWidth - STEP_POPOVER_WIDTH_PX - STEP_POPOVER_EDGE_PX);
  const left = Math.min(Math.max(rect.left, STEP_POPOVER_EDGE_PX), leftMax);
  assert(left >= STEP_POPOVER_EDGE_PX, 'A step popover stays inside the window on the left');
  return { position: 'fixed', left, ...popupBox(rect, STEP_POPOVER_HEIGHT_PX, window.innerHeight) };
}

function StepPopover(props: {
  readonly step: Exclude<Step, { readonly kind: 'settings' }>;
  readonly anchor: HTMLElement;
  readonly props: PageSettingsDialogProps;
  readonly confirmLabel: string;
  readonly confirm: () => void;
  readonly cancel: () => void;
}) {
  const translate = useTranslate();
  const summary = props.step.kind === 'confirm' ? props.step.summary : undefined;
  const ready = props.step.kind === 'confirm';
  return (
    <Popup
      mode="popover"
      anchor={props.anchor}
      onClose={props.cancel}
      dismissible={props.step.kind !== 'applying'}
      className="page-settings-move"
      role="dialog"
      style={stepPopoverPlace(props.anchor)}
    >
      <div
        className="page-settings-move-body"
        tabIndex={-1}
        ref={(element) => element?.focus()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && ready) {
            event.preventDefault();
            props.confirm();
          }
        }}
      >
        <div className="page-settings-confirm-title">{confirmTitle(props.step.action, props.props, translate)}</div>
        {summary === undefined ? (
          <SkeletonRows count={2} />
        ) : (
          <>
            <ul className="page-settings-bullets">
              {confirmLines(props.step.action, summary, props.props, translate).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ReviewList summary={summary} />
          </>
        )}
        <div className="page-settings-confirm-buttons">
          <button type="button" disabled={props.step.kind === 'applying'} onClick={props.cancel}>
            {translate('ui.cancel')}
          </button>
          <button type="button" className="primary" disabled={!ready} onClick={props.confirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </Popup>
  );
}

function HomeButton({ model, props }: { readonly model: Model; readonly props: PageSettingsDialogProps }) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const tooltip = useDelayedTooltip();
  const host = useRef<HTMLSpanElement>(null);
  const swap = homeSwapPlan(props.page.name, { pages: props.pages.map((page) => page.name), locales: props.locales ?? [] });
  const current = props.pages.find((page) => isHomePage(page.name));
  const unavailable = props.host.unavailable;
  const reason = !swap.ok ? translateDescribed(homeSwapRefusalText(swap.error)) : unavailable === undefined ? undefined : translateDescribed(unavailable);
  const replaces = current === undefined ? undefined : translate('pages.settings.home.replaces', { name: pageDisplayLabel(current, translate) });
  const tip = reason ?? replaces;
  const offered = model.step.kind !== 'settings' && model.step.action.kind === 'home' ? model.step : undefined;
  return (
    <span ref={host} className="page-settings-tip page-settings-home-button" onMouseEnter={tooltip.show} onMouseLeave={tooltip.hide}>
      <button
        type="button"
        aria-description={tip}
        disabled={model.busy || !props.allowed.rename || reason !== undefined}
        onClick={() => {
          if (swap.ok) {
            void model.begin({ kind: 'home', moves: swap.value });
          }
        }}
      >
        <HomeIcon size={12} />
        {translate('pages.settings.home.make')}
      </button>
      {offered !== undefined && host.current !== null && (
        <StepPopover
          step={offered}
          anchor={host.current}
          props={props}
          confirmLabel={translate('pages.settings.home.confirm')}
          confirm={() => void model.confirm()}
          cancel={model.cancel}
        />
      )}
      {tooltip.value !== undefined &&
        tip !== undefined &&
        createPortal(
          <div className="rail-tooltip below" role="tooltip" style={tooltip.value}>
            {tip}
          </div>,
          tooltipHost(host.current ?? undefined),
        )}
    </span>
  );
}

function ConfirmStep({ model, props }: { readonly model: Model; readonly props: PageSettingsDialogProps }) {
  const translate = useTranslate();
  const { step } = model;
  if (step.kind === 'settings') {
    return undefined;
  }
  const summary = step.kind === 'confirm' ? step.summary : undefined;
  return (
    <div className="page-settings-confirm">
      <div className="page-settings-confirm-title">{confirmTitle(step.action, props, translate)}</div>
      {summary === undefined ? (
        <SkeletonRows count={3} />
      ) : (
        <>
          <ul className="page-settings-bullets">
            {confirmLines(step.action, summary, props, translate).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ReviewList summary={summary} />
        </>
      )}
      <div className="page-settings-confirm-buttons">
        <button type="button" disabled={step.kind === 'applying'} onClick={model.cancel}>
          {translate('ui.cancel')}
        </button>
        <button
          type="button"
          className={step.action.kind === 'remove' ? 'primary danger' : 'primary'}
          disabled={step.kind !== 'confirm'}
          onClick={() => void model.confirm()}
        >
          {step.action.kind === 'remove' ? translate('pages.settings.confirm.delete') : translate('pages.settings.confirm.confirm')}
        </button>
      </div>
    </div>
  );
}

function ReviewList({ summary }: { readonly summary: PageSettingsSummary }) {
  const translate = useTranslate();
  if (summary.reviews.length === 0) {
    return undefined;
  }
  return (
    <div className="page-settings-review">
      <div className="page-settings-note">{translate('pages.settings.confirm.review')}</div>
      <ul>
        {summary.reviews.map((review) => (
          <li key={review.file + ':' + review.line}>
            <span className="page-settings-review-place">
              {review.file}:{review.line}
            </span>
            <span className="page-settings-review-text">{review.text}</span>
          </li>
        ))}
      </ul>
      {summary.reviewsMore > 0 && <div className="page-settings-note">{translate('pages.settings.confirm.reviewMore', { count: summary.reviewsMore })}</div>}
    </div>
  );
}

type Translate = ReturnType<typeof useTranslate>;

function confirmTitle(action: Action, props: PageSettingsDialogProps, translate: Translate): string {
  const name = pageDisplayLabel(props.page, translate);
  switch (action.kind) {
    case 'rename':
      return translate('pages.settings.confirm.renameTitle', { url: pageURLPath(action.to) });
    case 'home':
      return translate('pages.settings.confirm.homeTitle', { name });
    case 'remove':
      return translate('pages.settings.confirm.deleteTitle', { name });
    case 'duplicate':
      return translate('pages.settings.duplicate');
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function confirmLines(
  action: Action,
  summary: PageSettingsSummary,
  props: Pick<PageSettingsDialogProps, 'page' | 'pages'>,
  translate: Translate,
): readonly string[] {
  const files = translate('pages.settings.confirm.fileCount', { count: summary.files });
  const links = summary.links === 0 ? translate('pages.settings.confirm.noLinks') : translate('pages.settings.confirm.links', { count: summary.links, files });
  switch (action.kind) {
    case 'rename':
      return [
        translate('pages.settings.confirm.renameMoves', { from: props.page.route, to: pageURLPath(action.to) }),
        links,
        translate('pages.settings.confirm.nothingElse'),
      ];
    case 'home': {
      const name = pageDisplayLabel(props.page, translate);
      const home = props.pages.find((page) => page.name === action.moves.home.from);
      const homeName = home === undefined ? translate('ui.page.home') : pageDisplayLabel(home, translate);
      return [
        translate('pages.settings.confirm.homeBecomes', { name, file: 'src/pages/' + action.moves.page.to }),
        translate('pages.settings.confirm.oldHomeBecomes', {
          name: homeName,
          url: pageURLPath(action.moves.home.to),
          file: 'src/pages/' + action.moves.home.to,
        }),
        links,
        translate('pages.settings.confirm.nothingElse'),
      ];
    }
    case 'remove': {
      const lines = [translate('pages.settings.confirm.deleteFile', { file: 'src/pages/' + props.page.name })];
      if (/^(404|500)\./.test(props.page.name)) {
        lines.push(translate('pages.settings.confirm.deleteErrorPage'));
      }
      lines.push(
        summary.links === 0 ? translate('pages.settings.confirm.deleteNoLinks') : translate('pages.settings.confirm.deleteLinks', { count: summary.links }),
      );
      return lines;
    }
    case 'duplicate':
      return [];
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
