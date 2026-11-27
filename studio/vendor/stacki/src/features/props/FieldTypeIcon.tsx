
import { BracesIcon, CodeIcon, ComponentPropertiesIcon, ElementSlotIcon, FieldNumberIcon, FieldSwitchIcon, VariableTextSizeIcon } from '../../ui/Icons';

export function FieldTypeIcon({ type, name, size = 12 }: { readonly type: string; readonly name: string; readonly size?: number }) {
  const className = `prop-label-icon is-${type}`;
  if (type === 'slot' || name === 'slot') {
    return <ElementSlotIcon size={size} className={className} />;
  }
  switch (type) {
    case 'number':
      return <FieldNumberIcon size={size} className={className} />;
    case 'boolean':
      return <FieldSwitchIcon size={size} className={className} />;
    case 'enum':
      return <ComponentPropertiesIcon size={size} className={className} />;
    case 'attrs':
      return <BracesIcon size={size} className={className} />;
    case 'code':
    case 'style':
      return <CodeIcon size={size} className={className} />;
    case 'string':
    case 'other':
      return <VariableTextSizeIcon size={size} className={className} />;
    default:
      return undefined;
  }
}
