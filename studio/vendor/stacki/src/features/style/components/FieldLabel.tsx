import { useTranslate } from '../../../lib/i18n/useTranslate';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { arrowRotateCounterClockwise as centralArrowRotateCounterClockwise } from '../../../ui/central/centralGeometry';
import Popup from '../../../ui/Popup';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useInheritedSource } from '../model/computedStyle';
import InheritedPropertyLabel from './InheritedPropertyLabel';
import { panelBounds } from '../model/panelBox';
import { useHoverTip } from './CssPropertyTip';
import { useShortcutTip } from '../../../ui/shortcutTip';
import type { ScrubHandlers } from './useScrub';

const ResetGlyph = centralIcon(centralArrowRotateCounterClockwise, 12);

type Props = {
  children: ReactNode;
  inheritedProp?: string;
  active: boolean;
  onReset: () => void;
  resetLabel?: string;
  disabled?: boolean;
  title?: string;
  menuNote?: ReactNode | ((close: () => void) => ReactNode);
  onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
  scrubProps?: ScrubHandlers;
  className?: string;
  tooltip?: ReactNode;
};

export default function FieldLabel(props: Props) {
  const property = props.active ? '' : (props.inheritedProp ?? '');
  const source = useInheritedSource(property);
  if (source) {
    return (
      <InheritedPropertyLabel property={property} source={source} disabled={props.disabled ?? false} className={props.className ?? ''}>
        {props.children}
      </InheritedPropertyLabel>
    );
  }
  return <ClearableFieldLabel {...props} />;
}

function ClearableFieldLabel(props: Props) {
  const translate = useTranslate();
  const { children, active, disabled = false, title, onMouseDown, scrubProps, tooltip } = props;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hoverTip = useHoverTip<HTMLSpanElement>(tooltip);
  const nativeTitle = tooltip ? undefined : title;
  const rootRef = hoverTip.ref;
  const dropUp = useMenuPlacement({ open, rootRef, menuRef });

  useEffect(() => {
    if (!active) {
      setOpen(false);
    }
  }, [active]);

  if (!active) {
    return <DimCaption props={props} hoverTip={hoverTip} nativeTitle={nativeTitle} />;
  }

  const reset = () => {
    props.onReset();
    setOpen(false);
  };

  const onLabelClick = labelClickHandler({
    disabled,
    reset,
    toggle: () => setOpen((value) => !value),
    hideTip: hoverTip.hide,
  });

  return (
    <span ref={hoverTip.ref} className={['u-field-label-wrap', props.className].filter(Boolean).join(' ')} {...hoverTip.hoverProps}>
      <button
        type="button"
        className="u-field-label is-active"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled ? true : undefined}
        title={nativeTitle}
        onMouseDown={disabled ? undefined : onMouseDown}
        {...scrubProps}
        onClick={onLabelClick}
      >
        {children}
      </button>
      {open ? (
        <FieldLabelMenu
          id={menuId}
          menuRef={menuRef}
          dropUp={dropUp}
          resetLabel={props.resetLabel ?? translate('ui.reset')}
          menuNote={props.menuNote}
          onReset={reset}
          onClose={() => setOpen(false)}
        />
      ) : undefined}
      {}
      {hoverTip.tip}
    </span>
  );
}

function labelClickHandler(actions: { readonly disabled: boolean; readonly reset: () => void; readonly toggle: () => void; readonly hideTip: () => void }) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    actions.hideTip();
    if (actions.disabled) {
      return;
    }
    if (event.altKey) {
      actions.reset();
      return;
    }
    actions.toggle();
  };
}

function DimCaption({
  props,
  hoverTip,
  nativeTitle,
}: {
  props: Props;
  hoverTip: ReturnType<typeof useHoverTip<HTMLSpanElement>>;
  nativeTitle: string | undefined;
}) {
  return (
    <span
      ref={hoverTip.ref}
      className={['u-field-label', props.tooltip ? 'is-hoverable' : '', props.className].filter(Boolean).join(' ')}
      title={nativeTitle}
      onMouseDown={props.onMouseDown}
      {...props.scrubProps}
      {...hoverTip.hoverProps}
    >
      {props.children}
      {hoverTip.tip}
    </span>
  );
}


function useMenuPlacement({
  open,
  rootRef,
  menuRef,
}: {
  readonly open: boolean;
  readonly rootRef: RefObject<HTMLElement>;
  readonly menuRef: RefObject<HTMLDivElement>;
}): boolean {
  const [dropUp, setDropUp] = useState(false);
  useLayoutEffect(() => {
    const element = menuRef.current;
    const root = rootRef.current;
    if (!open || !element || !root) {
      return;
    }
    const margin = 8;
    const bounds = panelBounds(root);
    const rootRect = root.getBoundingClientRect();
    const naturalRight = rootRect.right;
    const naturalLeft = rootRect.right - element.offsetWidth;
    const leftLimit = bounds.left + margin;
    const rightLimit = bounds.right - margin;
    const next = naturalLeft < leftLimit ? leftLimit - naturalLeft : naturalRight > rightLimit ? rightLimit - naturalRight : 0;
    element.style.translate = next ? `${next}px 0` : '';
    const overflowsBelow = rootRect.bottom + element.offsetHeight + margin > bounds.bottom;
    const spaceAbove = rootRect.top - bounds.top;
    const spaceBelow = bounds.bottom - rootRect.bottom;
    setDropUp(overflowsBelow && spaceAbove > spaceBelow);
  }, [open, rootRef, menuRef]);
  return dropUp;
}

function FieldLabelMenu({
  id,
  menuRef,
  dropUp,
  resetLabel,
  menuNote,
  onReset,
  onClose,
}: {
  id: string;
  menuRef: RefObject<HTMLDivElement>;
  dropUp: boolean;
  resetLabel: string;
  menuNote: Props['menuNote'];
  onReset: () => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  const resetTip = useShortcutTip(resetLabel, translate('styleModel.shared.optionClick'));
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={onClose}
      id={id}
      ref={menuRef}
      className={['u-field-label-menu', dropUp ? 'is-up' : ''].filter(Boolean).join(' ')}
      role="menu"
    >
      <button
        type="button"
        className="u-field-label-menu-item"
        role="menuitem"
        onClick={(event) => {
          event.preventDefault();
          onReset();
        }}
        {...resetTip.props}
        aria-keyshortcuts={undefined}
      >
        <ResetGlyph className="u-field-label-menu-icon" />
        <span>{resetLabel}</span>
        {resetTip.tip}
      </button>
      {menuNote ? <div className="u-field-label-menu-note">{typeof menuNote === 'function' ? menuNote(onClose) : menuNote}</div> : undefined}
    </Popup>
  );
}
