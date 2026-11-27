import React, { useState } from 'react';
import { ElementLinkIcon } from '../../ui/Icons';
import { InlineCodeIcon, SubscriptIcon, SuperscriptIcon } from '../../ui/richTextIcons';
import type { FormatState, RichCommand, RichWrapTag } from './richFormat';

interface RichFormatButtonsProps {
  readonly states: FormatState;
  readonly onExec: (command: RichCommand) => void;
  readonly onWrap: (tag: RichWrapTag) => void;
  readonly onLink: () => void;
}

const RICH_ICON_SIZE = 14;

export interface RichGlide {
  readonly x: number;
  readonly width: number;
  readonly shown: boolean;
  readonly slide: boolean;
}

const GLIDE_HIDDEN: RichGlide = { x: 0, width: 0, shown: false, slide: false };

export function richGlideTo(previous: RichGlide, button: { readonly offsetLeft: number; readonly offsetWidth: number }): RichGlide {
  const width = button.offsetWidth;
  if (width > 0) {
    return { x: button.offsetLeft, width, shown: true, slide: previous.shown };
  }
  return previous;
}

export function RichFormatButtons({ states, onExec, onWrap, onLink }: RichFormatButtonsProps) {
  const [glide, setGlide] = useState<RichGlide>(GLIDE_HIDDEN);
  const follow = (target: EventTarget) => {
    const button = target instanceof Element ? target.closest('.rich-format-row > button') : undefined;
    if (button instanceof HTMLElement) {
      setGlide((previous) => richGlideTo(previous, button));
    }
  };
  const hide = () => setGlide((previous) => (previous.shown ? { ...previous, shown: false, slide: false } : previous));
  return (
    <div
      className="rich-format-row"
      onPointerOver={(event) => follow(event.target)}
      onPointerLeave={hide}
      onFocus={(event) => follow(event.target)}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          hide();
        }
      }}
    >
      <span
        aria-hidden="true"
        className={`rich-format-glide${glide.shown ? ' shown' : ''}${glide.slide ? ' slide' : ''}`}
        style={{ transform: `translateX(${glide.x}px)`, width: glide.width }}
      />
      {}
      {richButton(<b className="rich-glyph-bold">B</b>, 'Bold', { active: states.bold }, () => onExec('bold'))}
      {richButton(<i className="rich-glyph-italic">I</i>, 'Italic', { active: states.italic }, () => onExec('italic'))}
      {richButton(<SuperscriptIcon size={RICH_ICON_SIZE} />, 'Superscript', { active: states.superscript }, () => onExec('superscript'))}
      {richButton(<SubscriptIcon size={RICH_ICON_SIZE} />, 'Subscript', { active: states.subscript }, () => onExec('subscript'))}
      {richButton(<InlineCodeIcon size={RICH_ICON_SIZE} />, 'Code', { active: states.code }, () => onWrap('code'))}
      {}
      {richButton(<span className="rich-glyph-tag">span</span>, 'Wrap in a span', { active: states.span }, () => onWrap('span'))}
      {}
      {richButton(<ElementLinkIcon size={RICH_ICON_SIZE} />, 'Link', { active: states.link }, onLink)}
    </div>
  );
}

interface RichLinkFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly onBlur?: (() => void) | undefined;
}

export function RichLinkField(props: RichLinkFieldProps) {
  const { value, onChange, onApply, onCancel } = props;
  return (
    <input
      autoFocus
      onBlur={props.onBlur}
      className="rich-bubble-url"
      placeholder="https://…  (Enter to apply)"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onApply();
        }
        if (event.key === 'Escape') {
          onCancel();
        }
      }}
    />
  );
}

const richButton = (label: React.ReactNode, title: string, { active }: { readonly active: boolean | undefined }, onAct: () => void) => (
  <button
    key={title}
    type="button"
    className={active ? 'on' : ''}
    title={title}
    aria-pressed={active === true}
    onMouseDown={(event) => {
      event.preventDefault();
      onAct();
    }}
  >
    {label}
  </button>
);

export interface Bubble {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}
export interface BubblePosition {
  readonly left: number;
  readonly top: number;
  readonly below: boolean;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

export function richBubblePlace(bubble: Bubble, element: HTMLElement): BubblePosition {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const margin = 8;
  const left = clamp(bubble.x, margin + width / 2, window.innerWidth - margin - width / 2);
  const below = bubble.top - height - 10 < 48;
  const top = below ? bubble.bottom + 10 : bubble.top - 10;
  return { left, top, below };
}
