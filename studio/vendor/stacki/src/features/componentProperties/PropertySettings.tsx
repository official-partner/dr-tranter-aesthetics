
import { useState } from 'react';
import type { ReactNode } from 'react';
import AutoTextarea from '../../ui/AutoTextarea';
import { ErrorToast } from '../../ui/ErrorToast';
import { NoticeToast } from '../../ui/NoticeToast';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { ComponentProperty } from '../../../shared/properties/propertyEditing';
import { PROPERTY_LIMITS } from '../../../shared/properties/propertyEditing';
import { NUMBER_DECIMALS_MAX, numberNote } from '../../editor/propDocumentation';
import { propertyKind } from './propertyKinds';
import {
  legacyTagsOf,
  numberSettingProblem,
  numberSettingsOf,
  tagValue,
  tooltipOf,
  withTag,
  withTooltip,
  withoutLegacyTags,
  type SettingTagName,
} from './settingTags';

interface SettingsProps {
  readonly property: ComponentProperty;
  readonly onChange: (description: string) => void;
}

export function PropertyKindSettings({ property, onChange }: SettingsProps) {
  const kind = propertyKind(property);
  if (kind === 'number') {
    return <NumberSettingsFields key="number" property={property} onChange={onChange} />;
  }
  return undefined;
}

export function PropertyTooltip({ property, onChange, head, code }: SettingsProps & { readonly head?: ReactNode; readonly code?: ReactNode | undefined }) {
  const translate = useTranslate();
  const [editing, setEditing] = useState(false);
  const legacy = legacyTagsOf(property.description);
  return (
    <>
      <label className={head === undefined ? undefined : 'property-field'}>
        {}
        {head ?? translate('componentProps.settings.tooltip')}
        {}
        {code ?? (
          <AutoTextarea
            value={tooltipOf(property.description)}
            maxLength={PROPERTY_LIMITS.textCharsMax}
            placeholder={translate('componentProps.settings.tooltipPlaceholder')}
            onFocus={() => setEditing(true)}
            onChange={(event) => onChange(withTooltip(property.description, event.target.value))}
          />
        )}
      </label>
      {editing && legacy.length > 0 && (
        <p className="property-help property-legacy-tags">
          {translate('componentProps.settings.legacyTags', { count: legacy.length })}{' '}
          <button type="button" className="property-legacy-remove" onClick={() => onChange(withoutLegacyTags(property.description))}>
            {translate('componentProps.settings.legacyRemove', { count: legacy.length })}
          </button>
        </p>
      )}
    </>
  );
}

export function PropertyDefaultNote({ property }: { readonly property: ComponentProperty }) {
  const translate = useTranslate();
  if (propertyKind(property) !== 'number' || property.defaultValue.trim() === '') {
    return undefined;
  }
  const value = Number(property.defaultValue);
  const note = Number.isFinite(value) ? numberNote(value, numberSettingsOf(property.description), translate) : undefined;
  return <NoticeToast message={note === undefined ? undefined : translate('componentProps.settings.defaultNote', { note })} kind="warning" />;
}

type NumberTag = Extract<SettingTagName, 'min' | 'max' | 'decimals'>;
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

function NumberSettingsFields({ property, onChange }: SettingsProps) {
  const translate = useTranslate();
  const [texts, setTexts] = useState<Readonly<Record<NumberTag, string>>>(() => ({
    min: tagValue(property.description, 'min') ?? '',
    max: tagValue(property.description, 'max') ?? '',
    decimals: tagValue(property.description, 'decimals') ?? '',
  }));
  const typed = {
    min: numberText(texts.min),
    max: numberText(texts.max),
    decimals: numberText(texts.decimals),
  };
  const malformed = (['min', 'max', 'decimals'] as const).some((name) => texts[name].trim() !== '' && typed[name] === undefined);
  const problem = malformed ? translate('componentProps.settings.numberMalformed') : numberSettingProblem(typed, translate);
  const change = (name: NumberTag, text: string): void => {
    const next = { ...texts, [name]: text };
    setTexts(next);
    const settings = { min: numberText(next.min), max: numberText(next.max), decimals: numberText(next.decimals) };
    const value = numberText(text);
    if ((text.trim() === '' || value !== undefined) && numberSettingProblem(settings, translate) === undefined) {
      onChange(withTag(property.description, name, value === undefined ? undefined : String(value)));
    }
  };
  return (
    <div
      className={`property-settings${problem === undefined ? '' : ' is-invalid'}`}
      role="group"
      aria-label={translate('componentProps.settings.numberGroup')}
    >
      <div className="property-settings-row">
        <NumberSettingField
          label={translate('componentProps.settings.min')}
          placeholder={translate('componentProps.settings.none')}
          text={texts.min}
          onChange={(text) => change('min', text)}
        />
        <NumberSettingField
          label={translate('componentProps.settings.max')}
          placeholder={translate('componentProps.settings.none')}
          text={texts.max}
          onChange={(text) => change('max', text)}
        />
        <NumberSettingField
          label={translate('componentProps.settings.decimals')}
          placeholder={translate('componentProps.settings.auto')}
          text={texts.decimals}
          title={translate('componentProps.settings.decimalsHint', { max: NUMBER_DECIMALS_MAX })}
          onChange={(text) => change('decimals', text)}
        />
      </div>
      <ErrorToast message={problem} />
    </div>
  );
}

function NumberSettingField(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly text: string;
  readonly title?: string;
  readonly onChange: (text: string) => void;
}) {
  return (
    <label title={props.title}>
      {props.label}
      <input
        aria-label={props.label}
        inputMode="decimal"
        placeholder={props.placeholder}
        value={props.text}
        maxLength={32}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function numberText(text: string): number | undefined {
  const trimmed = text.trim();
  return NUMBER_TEXT.test(trimmed) ? Number(trimmed) : undefined;
}
