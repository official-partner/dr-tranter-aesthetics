import { record, text } from '../core/boundary';
import { parseContentSlug, type ContentSlug } from './pageTemplate';

export type TemplateReading =
  | { readonly kind: 'none' }
  | { readonly kind: 'custom'; readonly code: string }
  | {
      readonly kind: 'content';
      readonly collection: string;
      readonly slug: ContentSlug;
      readonly param: string;
      readonly api: 'current' | 'legacy';
      readonly code: string;
    };

export type WireTemplateReading = TemplateReading;

export function parseTemplateReading(input: unknown): TemplateReading {
  const value = record(input);
  switch (value['kind']) {
    case 'none':
      return { kind: 'none' };
    case 'custom':
      return { kind: 'custom', code: text(value['code']) };
    case 'content': {
      const collection = text(value['collection']);
      if (collection.length === 0) {
        throw new Error('Template reading: empty collection');
      }
      const param = text(value['param']);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(param)) {
        throw new Error('Template reading: invalid route parameter');
      }
      const api = value['api'];
      if (api !== 'current' && api !== 'legacy') {
        throw new Error('Template reading: unknown collection API');
      }
      return { kind: 'content', collection, slug: parseContentSlug(value['slug']), param, api, code: text(value['code']) };
    }
    default:
      throw new Error('Template reading: unknown kind');
  }
}
