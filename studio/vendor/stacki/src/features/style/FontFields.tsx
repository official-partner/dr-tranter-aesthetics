
import { useEffect, useState } from 'react';
import type { SelectOption } from './components/Select';
import { VariableSelect } from './KeywordConnect';
import { getProjectFontFamilies } from './model/webflow';
import { displayOf, displayText } from './model/styleDisplay';
import { useStyleHint } from './model/computedStyle';
import { type Props, CUSTOM, PropLabel, LiveInput } from './TypographyKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { useSelectorState } from './model/selectorScope';
import { useHoverPreview } from './connectFieldHelpers';



export const WEB_FONTS = ['Arial', 'Georgia', 'Impact', 'Palatino Linotype', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'system-ui'];

export const GOOGLE_FONTS = [
  'Bitter',
  'Changa One',
  'Droid Sans',
  'Droid Serif',
  'Exo',
  'Great Vibes',
  'Inconsolata',
  'Lato',
  'Merriweather',
  'Montserrat',
  'Open Sans',
  'Oswald',
  'PT Sans',
  'PT Serif',
  'Ubuntu',
  'Varela',
  'Varela Round',
  'Vollkorn',
];

const FONT_FAMILY_PLACEHOLDER = 'font-family';
const FONT_WEIGHT_PLACEHOLDER = 'font-weight';

export function primaryFamily(value: string): string {
  const first = value.split(',')[0] ?? value;
  return first
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
}
export function quoteFamily(name: string): string {
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name) ? name : `"${name}"`;
}

export function FontFamilyField(props: Props) {
  const hoverPreview = useHoverPreview();
  const { read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector } = props;
  const display = displayOf(read('font-family'));
  const translate = useTranslate();
  const [forceCustom, setForceCustom] = useSelectorState(false);
  const { options, byPrimary } = fontOptions(useProjectFonts(), translate);
  const computed = useStyleHint(display.present ? '' : 'font-family');
  const current = display.present ? display.value : computed;
  const matched = current ? byPrimary.get(primaryFamily(current)) : undefined;
  const customMode = forceCustom || (current.length > 0 && !matched) || display.important;

  const pick = (value: string) => {
    if (value === CUSTOM) {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    if (!value) {
      clearProp('font-family');
      return;
    }
    setProp('font-family', quoteFamily(value), false);
  };
  const clear = () => {
    setForceCustom(false);
    clearProp('font-family');
  };

  return (
    <div className="embed-editor_size-row">
      <PropLabel
        label={translate('style.fontFields.font')}
        prop="font-family"
        display={display}
        contributors={read('font-family')?.contributors ?? []}
        busy={busy}
        onClear={clear}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <VariableSelect
        prop="font-family"
        rawValue={display.present ? display.value : ''}
        onVariable={(binding) => {
          setForceCustom(false);
          setProp('font-family', binding, display.important);
        }}
        value={customMode ? CUSTOM : (matched ?? '')}
        options={options}
        onChange={pick}
        onPreview={(value) => {
          const previewed = value ?? undefined;
          const font = previewed && previewed !== CUSTOM ? quoteFamily(previewed) : undefined;
          hoverPreview('font-family', font, false);
        }}
        ariaLabel={translate('style.fontFields.fontFamily')}
        disabled={busy}
        searchable
        searchPlaceholder={translate('style.fontFields.searchFonts')}
        customInput={
          customMode ? (
            <LiveInput
              value={forceCustom && matched && !display.important ? '' : displayText(display)}
              busy={busy}
              placeholder={FONT_FAMILY_PLACEHOLDER}
              ariaLabel={translate('style.fontFields.fontFamily')}
              className="u-select-custom-input"
              prop="font-family"
              autoFocus={forceCustom}
              onCommit={(value, important) => setProp('font-family', value, important)}
              onLiveCommit={(value, important) => liveSetProp('font-family', value, important)}
              onClear={clear}
            />
          ) : undefined
        }
      />
    </div>
  );
}

export function useProjectFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getProjectFontFamilies().then((list) => {
      if (live) {
        setFonts(list);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return fonts;
}

export function fontOptions(fonts: string[], translate: Translator) {
  const builtInLower = new Set([...GOOGLE_FONTS, ...WEB_FONTS].map((font) => font.toLowerCase()));
  const customFonts = fonts.filter((font) => !builtInLower.has(font.toLowerCase()));
  const named = [...customFonts, ...GOOGLE_FONTS, ...WEB_FONTS];
  const byPrimary = new Map(named.map((font) => [primaryFamily(font), font]));
  const options: SelectOption<string>[] = [{ value: '', label: translate('style.fontFields.default') }];
  const group = (heading: string, headingLabel: string, list: string[]) => {
    if (!list.length) {
      return;
    }
    options.push({ value: `__head_${heading}`, label: headingLabel, heading: true });
    for (const font of list) {
      options.push({ value: font, label: font, indent: true });
    }
  };
  group('Custom fonts', translate('style.fontFields.customFonts'), customFonts);
  group('Google fonts', translate('style.fontFields.googleFonts'), GOOGLE_FONTS);
  group('Web fonts', translate('style.fontFields.webFonts'), WEB_FONTS);
  options.push({ value: CUSTOM, label: translate('style.fontFields.custom') });
  return { options, byPrimary };
}


export const WEIGHTS: ReadonlyArray<[string, string]> = [
  ['100', '100 - Thin'],
  ['200', '200 - Extra Light'],
  ['300', '300 - Light'],
  ['400', '400 - Normal'],
  ['500', '500 - Medium'],
  ['600', '600 - Semi Bold'],
  ['700', '700 - Bold'],
  ['800', '800 - Extra Bold'],
  ['900', '900 - Black'],
];
export const WEIGHT_VALUES = new Set(WEIGHTS.map(([weight]) => weight));
export const weightOptions = (translate: Translator): SelectOption<string>[] => [
  { value: '', label: translate('style.fontFields.weightDefault') },
  ...WEIGHTS.map(([value, label]) => ({ value, label })),
  { value: CUSTOM, label: translate('style.fontFields.custom') },
];
export function normalizeWeight(value: string): string {
  const text = value.trim().toLowerCase();
  if (text === 'normal') {
    return '400';
  }
  if (text === 'bold') {
    return '700';
  }
  return text;
}

export function WeightField(props: Props) {
  const hoverPreview = useHoverPreview();
  const { read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector } = props;
  const translate = useTranslate();
  const display = displayOf(read('font-weight'));
  const [forceCustom, setForceCustom] = useSelectorState(false);
  const computed = useStyleHint(display.present ? '' : 'font-weight');
  const normalized = normalizeWeight(display.present ? display.value : computed);
  const matched = WEIGHT_VALUES.has(normalized) ? normalized : undefined;
  const customMode = forceCustom || (normalized.length > 0 && !matched) || display.important;

  const pick = (value: string) => {
    if (value === CUSTOM) {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    if (!value) {
      clearProp('font-weight');
      return;
    }
    setProp('font-weight', value, false);
  };

  return (
    <div className="embed-editor_size-row">
      <PropLabel
        label={translate('style.fontFields.weight')}
        prop="font-weight"
        display={display}
        contributors={read('font-weight')?.contributors ?? []}
        busy={busy}
        onClear={() => {
          setForceCustom(false);
          clearProp('font-weight');
        }}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <VariableSelect
        prop="font-weight"
        rawValue={display.present ? display.value : ''}
        onVariable={(binding) => {
          setForceCustom(false);
          setProp('font-weight', binding, display.important);
        }}
        value={customMode ? CUSTOM : (matched ?? '')}
        options={weightOptions(translate)}
        onChange={pick}
        onPreview={(value) => hoverPreview('font-weight', value === CUSTOM ? undefined : (value ?? undefined), false)}
        ariaLabel={translate('style.fontFields.fontWeight')}
        disabled={busy}
        customInput={
          customMode ? (
            <LiveInput
              value={displayText(display)}
              busy={busy}
              placeholder={FONT_WEIGHT_PLACEHOLDER}
              ariaLabel={translate('style.fontFields.fontWeight')}
              className="u-select-custom-input"
              prop="font-weight"
              autoFocus={forceCustom}
              onCommit={(value, important) => setProp('font-weight', value, important)}
              onLiveCommit={(value, important) => liveSetProp('font-weight', value, important)}
              onClear={() => {
                setForceCustom(false);
                clearProp('font-weight');
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}
