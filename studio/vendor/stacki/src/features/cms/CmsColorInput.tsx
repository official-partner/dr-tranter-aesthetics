import ColorSwatch from '../style/components/ColorSwatch';
import { useTranslate } from '../../lib/i18n/useTranslate';

export function CmsColorInput(props: { readonly value: string; readonly label: string; readonly onChange: (value: string) => void }) {
  const translate = useTranslate();
  return (
    <div className="cms-color-input">
      <ColorSwatch
        value={props.value}
        ariaLabel={translate('cms.color.choose', { label: props.label })}
        onChange={(color, live) => {
          if (!live) {
            props.onChange(color);
          }
        }}
      />
      <input
        value={props.value}
        placeholder="#000000"
        spellCheck={false}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}
