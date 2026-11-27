import { remoteObject, type RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import type { RemoteReferenceOption } from '../../../shared/properties/cmsRemote';
import { remoteReferenceOptions } from '../../ipc/cmsConnectionsBridge';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import Dropdown from '../../ui/Dropdown';
import { useRemote } from './remoteCmsShared';
import { OPTION_IMAGE_MENU } from './projectImages';
import { ElementImageIcon } from '../../ui/Icons';
import { SanityTypeIcon, typeIcons } from './SanityTypeIcon';
import { REFERENCE_OPTIONS } from './remoteCmsCache';
import type { RemoteEditContext, RemoteValueProps } from './RemoteValueEditor';

const NONE = ' none';

export function RemoteReferenceInput(props: RemoteValueProps & { readonly to: readonly string[] }) {
  const translate = useTranslate();
  const options = useReferenceOptions(props.context, props.to);
  const icons = typeIcons(props.context.connectionId);
  const object = remoteObject(props.value);
  const current = object?.['_ref'];
  const chosen = typeof current === 'string' ? current : NONE;
  const known = options.some((option) => option.id === chosen);
  const pictures = hasReferenceImage(options);
  return (
    <Dropdown
      value={chosen}
      livePreview={false}
      searchable={true}
      searchPlaceholder={translate('ui.search')}
      menuClassName={pictures ? OPTION_IMAGE_MENU : ''}
      options={[
        { value: NONE, label: translate('cmsRemote.common.none'), dim: true },
        ...options.map((option) => ({
          value: option.id,
          label: option.title,
          icon: <ReferenceIcon option={option} sanity={icons.get(option.type)} placeholder={pictures} />,
        })),
        ...(known || chosen === NONE ? [] : [{ value: chosen, label: chosen, dim: true }]),
      ]}
      onChange={(id) => {
        if (id === NONE) {
          props.onChange(undefined);
        } else {
          props.onChange({ ...(object ?? {}), _type: 'reference', _ref: id });
        }
      }}
    />
  );
}

export function useReferenceOptions(context: Pick<RemoteEditContext, 'projectPath' | 'connectionId'>, to: readonly string[]): readonly RemoteReferenceOption[] {
  const { result } = useRemote(REFERENCE_OPTIONS, `${context.connectionId}:${to.join(',')}`, () =>
    remoteReferenceOptions(context.projectPath, context.connectionId, to),
  );
  return result?.ok ? result.value : [];
}

export function referenceTitle(value: RemoteValue | undefined, options: readonly RemoteReferenceOption[], translate: Translator): string {
  const id = remoteObject(value)?.['_ref'];
  if (typeof id !== 'string') {
    return translate('cmsRemote.common.none');
  }
  return options.find((option) => option.id === id)?.title ?? id;
}

export function hasReferenceImage(options: readonly RemoteReferenceOption[]): boolean {
  return options.some((option) => option.imageURL !== undefined);
}

export function ReferenceIcon(props: { readonly option: RemoteReferenceOption; readonly sanity: string | undefined; readonly placeholder: boolean }) {
  if (props.option.imageURL !== undefined) {
    return <ReferenceImage url={props.option.imageURL} />;
  }
  if (props.placeholder) {
    return (
      <span className="option-image is-placeholder">
        <ElementImageIcon size={12} />
      </span>
    );
  }
  return <SanityTypeIcon symbol={props.sanity} size={12} />;
}

const REFERENCE_IMAGE_PIXELS = 64;

export function ReferenceImage(props: { readonly url: string }) {
  const sized = new URL(props.url);
  sized.searchParams.set('w', String(REFERENCE_IMAGE_PIXELS));
  sized.searchParams.set('h', String(REFERENCE_IMAGE_PIXELS));
  sized.searchParams.set('fit', 'crop');
  sized.searchParams.set('auto', 'format');
  return (
    <span className="option-image">
      <img className="option-image-picture" src={sized.toString()} alt="" loading="lazy" draggable={false} />
    </span>
  );
}
