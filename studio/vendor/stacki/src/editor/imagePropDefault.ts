
import { assert } from '../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../shared/properties/i18n/messageRef';
import { err, ok, type Result } from '../../shared/core/result';

export type ImageDefault = { readonly kind: 'asset'; readonly specifier: string; readonly base: string } | { readonly kind: 'url'; readonly url: string };

export const IMAGE_TYPE = { name: 'ImageMetadata', path: 'astro' } as const;

export const IMAGE_LIMITS = { sourceCharsMax: 2048, baseCharsMax: 48 } as const satisfies Record<string, number>;

const IMPORTABLE = /\.(png|jpe?g|webp|avif|gif|svg|tiff?)$/i;
const RELATIVE = /^(\.\.?\/|[@~]\/)/;
const URL_LIKE = /^(https?:\/\/|\/\/|\/|data:image\/)/i;

export function imageDefaultOf(source: string, translate: Translator = ENGLISH_TRANSLATE): Result<ImageDefault, string> {
  const text = source.trim();
  if (text === '') {
    return err(translate('editor.imageDefault.choose'));
  }
  if (text.length > IMAGE_LIMITS.sourceCharsMax) {
    return err(translate('editor.imageDefault.tooLong'));
  }
  if (/["'`\\\n]/.test(text)) {
    return err(translate('editor.imageDefault.invalid'));
  }
  if (RELATIVE.test(text)) {
    if (!IMPORTABLE.test(text)) {
      return err(translate('editor.imageDefault.notImportable'));
    }
    const out: ImageDefault = { kind: 'asset', specifier: text, base: importBase(text) };
    assert(/^[A-Za-z_$][\w$]*$/.test(out.base), 'imageDefaultOf: an import is named by an identifier');
    return ok(out);
  }
  if (URL_LIKE.test(text)) {
    return ok({ kind: 'url', url: text });
  }
  return err(translate('editor.imageDefault.chooseOrUrl'));
}

export function imageDefaultChoice(source: string, translate: Translator = ENGLISH_TRANSLATE): Result<ImageDefault | undefined, string> {
  assert(source.length <= IMAGE_LIMITS.sourceCharsMax * 2, 'imageDefaultChoice: a source is bounded');
  if (source.trim() === '') {
    return ok(undefined);
  }
  return imageDefaultOf(source, translate);
}

export function imageTypeText(image: ImageDefault): string {
  switch (image.kind) {
    case 'asset':
      return IMAGE_TYPE.name;
    case 'url':
      return 'string';
    default: {
      const exhaustive: never = image;
      return exhaustive;
    }
  }
}

export function isImageType(typeText: string): boolean {
  assert(typeText.length <= IMAGE_LIMITS.sourceCharsMax, 'isImageType: a type is bounded');
  return typeText.split('|').some((part) => part.trim() === IMAGE_TYPE.name);
}

function importBase(specifier: string): string {
  const file = (specifier.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  const words = file.split(/[^A-Za-z0-9]+/).filter((word) => word !== '');
  const joined = words
    .map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
  const named = joined === '' ? 'image' : /^\d/.test(joined) ? `image${joined}` : joined;
  return named.slice(0, IMAGE_LIMITS.baseCharsMax);
}
