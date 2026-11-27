import type { SettingsFieldKind } from '../../../shared/properties/collectionSettings';
import type { MessageKey } from '../../lib/i18n/localeContext';

export const KIND_LABELS: Readonly<Record<SettingsFieldKind, MessageKey>> = {
  text: 'cmsRemote.fieldType.plainText',
  richText: 'cmsRemote.fieldType.richText',
  image: 'cmsRemote.fieldType.image',
  multiImage: 'cmsRemote.fieldType.multiImage',
  videoLink: 'cmsRemote.fieldType.videoLink',
  link: 'cmsRemote.fieldType.link',
  email: 'cmsRemote.fieldType.email',
  phone: 'cmsRemote.fieldType.phone',
  number: 'cmsRemote.fieldType.number',
  date: 'cmsRemote.fieldType.dateTime',
  switch: 'cmsRemote.fieldType.switch',
  color: 'cmsRemote.fieldType.color',
  option: 'cmsRemote.fieldType.option',
  file: 'cmsRemote.fieldType.file',
  reference: 'cmsRemote.fieldType.reference',
  multiReference: 'cmsRemote.fieldType.multiReference',
  list: 'cmsRemote.fieldType.list',
  repeater: 'cmsRemote.fieldType.list',
  group: 'cmsRemote.fieldType.group',
  keyValue: 'cmsRemote.fieldType.keyValue',
  constant: 'cmsRemote.fieldType.constant',
  any: 'cmsRemote.fieldType.anyValue',
  other: 'cmsRemote.fieldType.custom',
};
