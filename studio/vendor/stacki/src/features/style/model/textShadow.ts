
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../../shared/properties/i18n/messageRef';
import { isShadowLength, splitTopLevelCommas, splitTopLevelSpaces } from './background';

export type Shadow = { x: string; y: string; blur: string; color: string };

export function parseShadows(value: string): Shadow[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return [];
  }
  return splitTopLevelCommas(trimmed)
    .filter(Boolean)
    .map((part) => {
      const lengths: string[] = [];
      let color = '';
      for (const token of splitTopLevelSpaces(part)) {
        if (isShadowLength(token)) {
          lengths.push(token);
        } else {
          color = color ? `${color} ${token}` : token;
        }
      }
      return {
        x: lengths[0] ?? '0px',
        y: lengths[1] ?? '0px',
        blur: lengths[2] ?? '0px',
        color: color || 'rgba(0, 0, 0, 0.2)',
      };
    });
}

export function serializeShadows(shadows: Shadow[]): string {
  if (!shadows.length) {
    return '';
  }
  return shadows.map((shadow) => `${shadow.x || '0px'} ${shadow.y || '0px'} ${shadow.blur || '0px'}` + (shadow.color ? ` ${shadow.color}` : '')).join(', ');
}

export function blankShadow(): Shadow {
  return { x: '0px', y: '1px', blur: '1px', color: 'rgba(0, 0, 0, 0.2)' };
}

export function shadowLabel(shadow: Shadow, translate: Translator = ENGLISH_TRANSLATE): string {
  return translate('styleModel.textShadow.label', { x: shadow.x || '0px', y: shadow.y || '0px', blur: shadow.blur || '0px' });
}
