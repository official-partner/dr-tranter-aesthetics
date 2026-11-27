
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../../shared/properties/i18n/messageRef';
import { isShadowLength, splitTopLevelCommas, splitTopLevelSpaces } from './background';

export type BoxShadow = {
  inset: boolean;
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
};
export type BoxShadowPatch =
  Pick<BoxShadow, 'inset'> | Pick<BoxShadow, 'x'> | Pick<BoxShadow, 'y'> | Pick<BoxShadow, 'blur'> | Pick<BoxShadow, 'spread'> | Pick<BoxShadow, 'color'>;

export function parseBoxShadows(value: string): BoxShadow[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return [];
  }
  return splitTopLevelCommas(trimmed)
    .filter(Boolean)
    .map((part) => {
      const lengths: string[] = [];
      let color = '';
      let inset = false;
      for (const token of splitTopLevelSpaces(part)) {
        if (/^inset$/i.test(token)) {
          inset = true;
          continue;
        }
        if (isShadowLength(token)) {
          lengths.push(token);
        } else {
          color = color ? `${color} ${token}` : token;
        }
      }
      return {
        inset,
        x: lengths[0] ?? '0px',
        y: lengths[1] ?? '0px',
        blur: lengths[2] ?? '0px',
        spread: lengths[3] ?? '0px',
        color: color || 'rgba(0, 0, 0, 0.2)',
      };
    });
}

function boxShadowLengths(shadow: BoxShadow): string {
  const { x, y, blur, spread } = shadow;
  return `${x || '0px'} ${y || '0px'} ${blur || '0px'} ${spread || '0px'}`;
}

export function serializeBoxShadows(shadows: BoxShadow[]): string {
  if (!shadows.length) {
    return '';
  }
  return shadows.map((shadow) => `${shadow.inset ? 'inset ' : ''}${boxShadowLengths(shadow)}` + (shadow.color ? ` ${shadow.color}` : '')).join(', ');
}

export function blankBoxShadow(): BoxShadow {
  return {
    inset: false,
    x: '0px',
    y: '2px',
    blur: '5px',
    spread: '0px',
    color: 'rgba(0, 0, 0, 0.2)',
  };
}

export function boxShadowLabel(shadow: BoxShadow, translate: Translator = ENGLISH_TRANSLATE): string {
  const lengths = boxShadowLengths(shadow);
  return shadow.inset ? translate('styleModel.boxShadow.inner', { lengths }) : translate('styleModel.boxShadow.outer', { lengths });
}
