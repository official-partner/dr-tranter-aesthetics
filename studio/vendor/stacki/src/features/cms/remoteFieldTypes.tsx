import type { ReactElement } from 'react';
import type { RemoteType } from '../../../shared/properties/cmsRemoteSchema';
import type { MessageKey } from '../../lib/i18n/localeContext';
import type { IconProps } from '../../ui/IconBase';
import {
  BracesIcon,
  CalendarIcon,
  CollectionIcon,
  FieldNumberIcon,
  FieldSwitchIcon,
  MailIcon,
  MapPinIcon,
  PaperclipIcon,
  ParagraphIcon,
  TagIcon,
  TextIcon,
} from '../../ui/Icons';
import { ElementImageIcon, ElementLinkIcon, ElementListDefaultIcon, ElementSelectIcon } from '../../ui/ElementIcons';

type Icon = (props: IconProps) => ReactElement;

export interface FieldTypeLook {
  readonly icon: Icon;
  readonly labelKey: MessageKey;
}

export function fieldTypeOf(type: RemoteType): FieldTypeLook {
  switch (type.kind) {
    case 'string':
      if (type.asset === 'image') {
        return { icon: ElementImageIcon, labelKey: 'cmsRemote.fieldType.image' };
      }
      return type.options.length > 0
        ? { icon: ElementSelectIcon, labelKey: 'cmsRemote.fieldType.option' }
        : { icon: TextIcon, labelKey: 'cmsRemote.fieldType.plainText' };
    case 'text':
      return { icon: TextIcon, labelKey: 'cmsRemote.fieldType.longText' };
    case 'url':
      return { icon: ElementLinkIcon, labelKey: 'cmsRemote.fieldType.link' };
    case 'email':
      return { icon: MailIcon, labelKey: 'cmsRemote.fieldType.email' };
    case 'number':
      return { icon: FieldNumberIcon, labelKey: 'cmsRemote.fieldType.number' };
    case 'boolean':
      return { icon: FieldSwitchIcon, labelKey: 'cmsRemote.fieldType.switch' };
    case 'date':
      return { icon: CalendarIcon, labelKey: 'cmsRemote.fieldType.date' };
    case 'datetime':
      return { icon: CalendarIcon, labelKey: 'cmsRemote.fieldType.dateTime' };
    case 'slug':
      return { icon: TagIcon, labelKey: 'cmsRemote.fieldType.slug' };
    case 'geopoint':
      return { icon: MapPinIcon, labelKey: 'cmsRemote.fieldType.location' };
    case 'object':
      return { icon: BracesIcon, labelKey: 'cmsRemote.fieldType.group' };
    case 'image':
      return { icon: ElementImageIcon, labelKey: 'cmsRemote.fieldType.image' };
    case 'file':
      return { icon: PaperclipIcon, labelKey: 'cmsRemote.fieldType.file' };
    case 'reference':
      return { icon: CollectionIcon, labelKey: 'cmsRemote.fieldType.reference' };
    case 'richText':
      return { icon: ParagraphIcon, labelKey: 'cmsRemote.fieldType.richText' };
    case 'array':
      return listTypeOf(type.of);
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function listTypeOf(of: readonly RemoteType[]): FieldTypeLook {
  const kinds = new Set(of.map((member) => member.kind));
  const only = kinds.size === 1 ? of[0]?.kind : undefined;
  if (only === 'image') {
    return { icon: ElementImageIcon, labelKey: 'cmsRemote.fieldType.multiImage' };
  }
  if (only === 'reference') {
    return { icon: CollectionIcon, labelKey: 'cmsRemote.fieldType.multiReference' };
  }
  return { icon: ElementListDefaultIcon, labelKey: 'cmsRemote.fieldType.list' };
}

export function nameInSentence(name: string, locale: string): string {
  return locale === 'de' ? name : name.toLocaleLowerCase(locale);
}
