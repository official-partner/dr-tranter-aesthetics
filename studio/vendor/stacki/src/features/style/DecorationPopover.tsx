
import Select, { type SelectOption } from './components/Select';
import { VariableSelect, variableIn } from './KeywordConnect';
import { RatioOtherInput } from './AspectRatioField';
import ColorSwatch from './components/ColorSwatch';
import { splitTopLevelSpaces } from './model/background';
import { displayOf } from './model/styleDisplay';
import TipAnchor from '../../ui/TipAnchor';
import ImportantMark from './components/ImportantMark';
import { DecorNoneIcon, DecorStrikeIcon, DecorUnderlineIcon, DecorOverlineIcon } from './TypographyIcons';
import { type Props, LiveInput } from './TypographyKit';
import { PopLabel, LengthRow } from './TypographyColumns';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { useHoverPreview } from './connectFieldHelpers';


export const DECOR_LINE_KW = ['underline', 'overline', 'line-through', 'blink'];
export const DECOR_STYLE_KW = ['solid', 'double', 'dotted', 'dashed', 'wavy'];
export const LINE_ORDER = ['underline', 'overline', 'line-through'];
export const DECOR_PROPS = ['text-decoration', 'text-decoration-thickness', 'text-decoration-skip-ink'] as const;

export type DecorParts = { lines: string[]; style: string; color: string };

export function parseDecoration(value: string): DecorParts {
  const lines: string[] = [];
  let style = '';
  const color: string[] = [];
  for (const tok of splitTopLevelSpaces(value).filter(Boolean)) {
    const low = tok.toLowerCase();
    if (low === 'none') {
      continue;
    }
    if (DECOR_LINE_KW.includes(low)) {
      if (!lines.includes(low)) {
        lines.push(low);
      }
    } else if (DECOR_STYLE_KW.includes(low)) {
      style = low;
    } else {
      color.push(tok);
    }
  }
  return { lines, style, color: color.join(' ') };
}
export function composeDecoration({ lines, style, color }: DecorParts): string {
  const ordered = LINE_ORDER.filter((line) => lines.includes(line));
  return [...ordered, style, color].filter(Boolean).join(' ').trim() || 'none';
}
export function lineKey(lines: string[]): string {
  const ordered = LINE_ORDER.filter((line) => lines.includes(line));
  return ordered.length ? ordered.join(' ') : 'none';
}

export function StyleGlyph({ variant }: { variant: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy' }) {
  if (variant === 'double') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 6h12M2 10h12" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (variant === 'wavy') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 8q1.5-2 3 0t3 0 3 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  const dash = variant === 'dotted' ? '1 2' : variant === 'dashed' ? '3 2' : undefined;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
}

export const decorLineOptions = (translate: Translator): SelectOption<string>[] => [
  { value: 'none', label: translate('style.decorationPopover.lineNone'), icon: <DecorNoneIcon /> },
  { value: 'line-through', label: translate('style.decorationPopover.lineStrike'), icon: <DecorStrikeIcon /> },
  { value: 'underline', label: translate('style.decorationPopover.lineUnderline'), icon: <DecorUnderlineIcon /> },
  { value: 'overline', label: translate('style.decorationPopover.lineOverline'), icon: <DecorOverlineIcon /> },
  { value: 'underline overline', label: translate('style.decorationPopover.lineUnderOver') },
  { value: 'underline line-through', label: translate('style.decorationPopover.lineUnderStrike') },
  { value: 'overline line-through', label: translate('style.decorationPopover.lineOverStrike') },
  { value: 'underline overline line-through', label: translate('style.decorationPopover.lineAll') },
];
export const decorStyleOptions = (translate: Translator): SelectOption<string>[] => [
  { value: 'solid', label: translate('style.decorationPopover.styleSolid'), icon: <StyleGlyph variant="solid" /> },
  { value: 'double', label: translate('style.decorationPopover.styleDouble'), icon: <StyleGlyph variant="double" /> },
  { value: 'dotted', label: translate('style.decorationPopover.styleDotted'), icon: <StyleGlyph variant="dotted" /> },
  { value: 'dashed', label: translate('style.decorationPopover.styleDashed'), icon: <StyleGlyph variant="dashed" /> },
  { value: 'wavy', label: translate('style.decorationPopover.styleWavy'), icon: <StyleGlyph variant="wavy" /> },
];
export const skipInkOptions = (translate: Translator): SelectOption<string>[] => [
  { value: 'auto', label: translate('style.decorationPopover.skipAuto') },
  { value: 'none', label: translate('style.decorationPopover.skipNone') },
];

export function DecorationPopover(props: Props) {
  const hoverPreview = useHoverPreview();
  const { read, busy, setProp, liveSetProp } = props;
  const translate = useTranslate();
  const display = displayOf(read('text-decoration'));
  const raw = display.present ? display.value : displayOf(read('text-decoration-line')).value;
  const parts = parseDecoration(raw);
  const write: DecorationWrite = (next, mode = 'commit') =>
    (mode === 'live' ? liveSetProp : setProp)('text-decoration', composeDecoration(next), display.important);
  const preview = (value: string | undefined, next: (value: string) => DecorParts) => {
    hoverPreview('text-decoration', value === undefined ? undefined : composeDecoration(next(value)), display.important);
  };
  const rowProps = { props, parts, shorthandSet: display.isSelected, write };
  const skip = displayOf(read('text-decoration-skip-ink'));

  return (
    <div className="embed-editor_more-group">
      <DecorationSelectRow
        {...rowProps}
        label={translate('style.decorationPopover.line')}
        facet="lines"
        value={lineKey(parts.lines)}
        options={decorLineOptions(translate)}
        toParts={(value) => ({ ...parts, lines: value === 'none' ? [] : value.split(' ') })}
        preview={preview}
      />
      <DecorationSelectRow
        {...rowProps}
        label={translate('style.decorationPopover.style')}
        facet="style"
        value={parts.style || 'solid'}
        options={decorStyleOptions(translate)}
        toParts={(value) => ({ ...parts, style: value === 'solid' ? '' : value })}
        preview={preview}
      />
      <LengthRow prop="text-decoration-thickness" label={translate('style.decorationPopover.thick')} placeholder={AUTO_KEYWORD} {...props} />
      <DecorationColorRow {...rowProps} />
      <div className="embed-editor_size-row">
        <PopLabel label={translate('style.decorationPopover.skipInk')} prop="text-decoration-skip-ink" {...props} />
        {}
        {}
        <TipAnchor text={translate('style.decorationPopover.note')}>
          <ImportantMark important={skip.important}>
            <VariableSelect
              prop="text-decoration-skip-ink"
              rawValue={skip.present ? skip.value : ''}
              onVariable={(binding) => setProp('text-decoration-skip-ink', binding, skip.important)}
              customInput={
                skip.present && variableIn(skip.value) !== undefined ? (
                  <RatioOtherInput
                    value={skip.value}
                    busy={busy}
                    prop="text-decoration-skip-ink"
                    ariaLabel={translate('style.decorationPopover.skipInk')}
                    onCommit={(value, important) => setProp('text-decoration-skip-ink', value, important || skip.important)}
                    onLiveCommit={(value, important) => props.liveSetProp('text-decoration-skip-ink', value, important || skip.important)}
                    onClear={() => props.clearProp('text-decoration-skip-ink')}
                  />
                ) : undefined
              }
              value={skip.present ? skip.value.trim().toLowerCase() : 'auto'}
              options={skipInkOptions(translate)}
              onChange={(value) => setProp('text-decoration-skip-ink', value, skip.important)}
              onPreview={(value) => hoverPreview('text-decoration-skip-ink', value ?? undefined, skip.important)}
              ariaLabel={translate('style.decorationPopover.skipInk')}
              disabled={busy}
            />
          </ImportantMark>
        </TipAnchor>
      </div>
    </div>
  );
}

const AUTO_KEYWORD = 'Auto';

export type DecorationWrite = (next: DecorParts, mode?: 'live' | 'commit') => void;

export type DecorationRowProps = {
  props: Props;
  parts: DecorParts;
  shorthandSet: boolean;
  write: DecorationWrite;
};

export function DecorationSelectRow({
  props,
  parts,
  shorthandSet,
  write,
  label,
  facet,
  value,
  options,
  toParts,
  preview,
}: DecorationRowProps & {
  label: string;
  facet: 'lines' | 'style';
  value: string;
  options: SelectOption<string>[];
  toParts: (value: string) => DecorParts;
  preview: (value: string | undefined, next: (value: string) => DecorParts) => void;
}) {
  const translate = useTranslate();
  const lines = facet === 'lines';
  return (
    <div className="embed-editor_size-row">
      <PopLabel
        label={label}
        prop="text-decoration"
        {...props}
        active={lines ? shorthandSet : shorthandSet && parts.style !== ''}
        onClear={() => (lines ? props.clearProp(['text-decoration', 'text-decoration-line']) : write({ ...parts, style: '' }))}
      />
      <Select
        value={value}
        options={options}
        onChange={(next) => write(toParts(next))}
        onPreview={(next) => preview(next ?? undefined, toParts)}
        ariaLabel={lines ? translate('style.decorationPopover.decorationLine') : translate('style.decorationPopover.decorationStyle')}
        disabled={props.busy}
      />
    </div>
  );
}

export function DecorationColorRow({ props, parts, shorthandSet, write }: DecorationRowProps) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_size-row">
      <PopLabel
        label={translate('style.decorationPopover.color')}
        prop="text-decoration"
        {...props}
        active={shorthandSet && parts.color !== ''}
        onClear={() => write({ ...parts, color: '' })}
      />
      <div className="embed-editor_type-field">
        <ColorSwatch
          value={parts.color}
          busy={props.busy}
          ariaLabel={translate('style.decorationPopover.decorationColor')}
          onChange={(color, live) => write({ ...parts, color }, live ? 'live' : 'commit')}
        />
        <LiveInput
          value={parts.color}
          busy={props.busy}
          placeholder={translate('style.decorationPopover.setColor')}
          ariaLabel={translate('style.decorationPopover.decorationColor')}
          className="u-input embed-editor_size-input"
          prop="color"
          onCommit={(value) => write({ ...parts, color: value })}
          onLiveCommit={(value) => write({ ...parts, color: value }, 'live')}
          onClear={() => write({ ...parts, color: '' })}
        />
      </div>
    </div>
  );
}
