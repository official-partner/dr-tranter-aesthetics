import { createContext, useContext } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';
import type { EditingField, EditingSetting, EditingSettings } from '../../../shared/properties/componentDefaults';
import { assert } from '../../../shared/core/assert';
import TipAnchor from '../../ui/TipAnchor';
import Popup from '../../ui/Popup';
import { CloseIcon, DragIcon, ElementSlotIcon } from '../../ui/Icons';

export interface FieldEditingHost {
  readonly slots: readonly string[];
  readonly offered: (field: EditingField) => readonly EditingSetting[];
  readonly settings: (field: EditingField) => EditingSettings;
  readonly change: (field: EditingField, setting: EditingSetting, state: 'on' | 'off') => void;
}

export const FieldEditingContext = createContext<FieldEditingHost | undefined>(undefined);

const LABELS: Readonly<Record<EditingSetting, MessageKey>> = {
  lineBreaks: 'props.editing.lineBreaks',
  richText: 'props.editing.richText',
};
const TIPS: Readonly<Record<EditingSetting, MessageKey>> = {
  lineBreaks: 'props.editing.lineBreaksTip',
  richText: 'props.editing.richTextTip',
};

export function PropertyEditingSettings({ field }: { readonly field: EditingField | undefined }) {
  const host = useContext(FieldEditingContext);
  const translate = useTranslate();
  if (host === undefined || field === undefined || field === '') {
    return undefined;
  }
  const offered = host.offered(field);
  const settings = host.settings(field);
  assert(offered.length <= 2, 'A field takes at most the two editing settings');
  return (
    <div className="property-flags property-editing-flags">
      {offered.map((setting) => (
        <TipAnchor key={setting} text={translate(TIPS[setting])}>
          <label>
            <input
              type="checkbox"
              aria-label={translate(LABELS[setting])}
              checked={settings[setting] === true}
              onChange={(event) => host.change(field, setting, event.target.checked ? 'on' : 'off')}
            />
            {translate(LABELS[setting])}
          </label>
        </TipAnchor>
      ))}
    </div>
  );
}

export function SlotEditingRows({ disabled, onOpen }: { readonly disabled: boolean; readonly onOpen: (slot: string) => void }) {
  const host = useContext(FieldEditingContext);
  const translate = useTranslate();
  if (host === undefined) {
    return undefined;
  }
  const slots = host.slots.filter((slot) => host.offered(`slot:${slot}`).length > 0);
  return (
    <>
      {slots.map((slot) => (
        <div key={slot} className="list-field-row property-row property-slot-row">
          <span className="list-field-grip property-grip-space" aria-hidden="true">
            <DragIcon size={12} />
          </span>
          <button type="button" className="list-field-text property-row-main" disabled={disabled} onClick={() => onOpen(slot)}>
            <span className="list-field-icon" aria-hidden="true">
              <ElementSlotIcon size={14} />
            </span>
            {slotLabel(slot, translate)}
          </button>
        </div>
      ))}
    </>
  );
}

function slotLabel(slot: string, translate: ReturnType<typeof useTranslate>): string {
  return slot === 'default' ? translate('props.element.content') : slot;
}

export function SlotEditingEditor({ slot, onClose }: { readonly slot: string; readonly onClose: () => void }) {
  const translate = useTranslate();
  const label = slotLabel(slot, translate);
  return (
    <Popup mode="popover" portal={false} className="property-editor" label={label} onClose={onClose} dismissible={true}>
      {({ close }) => (
        <>
          <header>
            <div className="property-editor-title">
              <strong>{label}</strong>
            </div>
            <button aria-label={translate('componentProps.dialog.close')} onClick={close}>
              <CloseIcon size={12} />
            </button>
          </header>
          <PropertyEditingSettings field={`slot:${slot}`} />
        </>
      )}
    </Popup>
  );
}
