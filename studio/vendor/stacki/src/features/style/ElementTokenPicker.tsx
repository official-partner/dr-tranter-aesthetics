import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ElementSnapshot } from './model/styleTypes';
import { isAstroGeneratedAttribute, snapshotTokens } from './model/elementTokens';
import { TOOLTIP_DELAY_MS } from '../../ui/delayedTooltip';
import { assert } from '../../../shared/core/assert';
import { isInternalAttribute } from '../../../shared/core/internalAttributes';

export default function ElementTokenPicker({ snapshot }: { snapshot: ElementSnapshot | undefined }) {
  const parts = useMemo(() => elementParts(snapshot), [snapshot]);
  const tipParts = useMemo(() => elementTipParts(snapshot), [snapshot]);
  const tip = useElementTip();
  if (parts.length === 0) {
    return undefined;
  }
  return (
    <>
      <div className="embed-editor_element-id" onMouseEnter={tip.show} onMouseLeave={tip.hide}>
        {parts.join('')}
      </div>
      {tip.place === undefined
        ? undefined
        : createPortal(
            <div className="embed-editor_element-tip" role="tooltip" style={{ left: tip.place.left, top: tip.place.top, maxWidth: tip.place.widthMax }}>
              {tipParts.map((part, index) => (
                <span key={`${index}:${part.text}`} className={`embed-editor_element-tip-chip is-${part.kind}`}>
                  {part.text}
                </span>
              ))}
            </div>,
            document.body,
          )}
    </>
  );
}

export function elementParts(snapshot: ElementSnapshot | undefined): readonly string[] {
  const named = snapshotTokens(snapshot).filter((token) => (token.label ?? '') !== '');
  const parts = named.map((token) => {
    const name = token.label ?? '';
    if (token.kind === 'tag') {
      return name;
    }
    if (token.kind === 'class') {
      return `.${name}`;
    }
    const value = snapshot?.attributes[name] ?? '';
    return value ? `[${name}="${value}"]` : `[${name}]`;
  });
  assert(parts.length === named.length, 'elementParts: one part per named token');
  return parts;
}

export interface TipPart {
  readonly kind: 'tag' | 'class' | 'id' | 'attribute';
  readonly text: string;
}

export function elementTipParts(snapshot: ElementSnapshot | undefined): readonly TipPart[] {
  if (snapshot === undefined) {
    return [];
  }
  const named = snapshotTokens(snapshot)
    .filter((token) => token.kind !== 'attribute')
    .filter((token) => (token.label ?? '') !== '')
    .map((token): TipPart => (token.kind === 'tag' ? { kind: 'tag', text: token.label ?? '' } : { kind: 'class', text: `.${token.label ?? ''}` }));
  const id: TipPart[] = snapshot.id === undefined || snapshot.id === '' ? [] : [{ kind: 'id', text: `#${snapshot.id}` }];
  const attributes = Object.keys(snapshot.attributes)
    .filter((name) => name !== '' && name !== 'class' && name !== 'id' && !isAstroGeneratedAttribute(name) && !isInternalAttribute(name))
    .sort()
    .map((name): TipPart => {
      const value = snapshot.attributes[name] ?? '';
      return { kind: 'attribute', text: value ? `[${name}="${value}"]` : `[${name}]` };
    });
  const parts = [...named, ...id, ...attributes];
  assert(
    parts.every((part) => part.text.length > 0),
    'elementTipParts: every chip has text',
  );
  return parts;
}

interface TipPlace {
  readonly left: number;
  readonly top: number;
  readonly widthMax: number;
}

const TIP_GAP_PX = 6;
const TIP_WIDTH_PX_MIN = 200;

function useElementTip(): { readonly place: TipPlace | undefined; readonly show: (event: React.MouseEvent<HTMLElement>) => void; readonly hide: () => void } {
  const [place, setPlace] = useState<TipPlace | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (event: React.MouseEvent<HTMLElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setPlace({ left: rect.left, top: rect.bottom + TIP_GAP_PX, widthMax: Math.max(rect.width, TIP_WIDTH_PX_MIN) }),
      TOOLTIP_DELAY_MS,
    );
  };
  const hide = (): void => {
    clearTimeout(timer.current);
    setPlace(undefined);
  };
  return { place, show, hide };
}
