import { useTranslate } from '../lib/i18n/useTranslate';
import { ErrorToast } from '../ui/ErrorToast';
interface DynamicPickerProps {
  readonly entries: readonly { readonly label: string }[];
  readonly index: number;
  readonly onPick: (index: number) => void;
  readonly error?: string | undefined;
  readonly pattern: string;
}
import Dropdown from '../ui/Dropdown';
import { FileIcon } from '../ui/Icons';

export default function DynamicPicker({ entries, index, onPick, error, pattern }: DynamicPickerProps) {
  const translate = useTranslate();
  if (error) {
    return <ErrorToast message={translate('shell.dynamicPicker.loadFailed', { error })} />;
  }
  if (!entries.length) {
    return (
      <span className="route-chip" title={translate('shell.dynamicPicker.noPathsTitle', { pattern })}>
        {translate('shell.dynamicPicker.noPaths')}
      </span>
    );
  }
  return (
    <span className="route-picker" title={translate('shell.dynamicPicker.title')}>
      <Dropdown
        className="route-dd collection"
        menuClassName="route-menu collection"
        value={String(index)}
        options={entries.map((entry, i) => ({
          value: String(i),
          label: entry.label,
          icon: <FileIcon size={12} />,
        }))}
        onChange={(value: string) => onPick(Number(value))}
        livePreview={false}
        searchable
        searchPlaceholder={translate('shell.dynamicPicker.search')}
      />
    </span>
  );
}
