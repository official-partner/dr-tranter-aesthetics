import Select, { type SelectOption } from './components/Select';
import { ShadowColorRow, ShadowLength } from './ShadowFields';
import { AngleControl } from './GradientEditor';
import { FILTER_GROUPS, FILTER_META, retypeFilter, type Filter, type FilterPatch, type FilterType } from './model/filter';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';


const typeOptions = (translate: Translator) =>
  FILTER_GROUPS.flatMap<SelectOption<string>>((group) => [
    { value: `__h_${group.heading}`, label: translate(group.headingKey), heading: true },
    ...group.types.map((type) => ({ value: type, label: translate(FILTER_META[type].labelKey), indent: true })),
  ]);

function isFilterType(value: string): value is FilterType {
  return value in FILTER_META;
}

interface SetOptions {
  readonly live: boolean;
}
type SetFilter = (patch: FilterPatch, options: SetOptions) => void;

export default function FilterEditor({ filter, busy, onChange }: { filter: Filter; busy: boolean; onChange: (next: Filter, live: boolean) => void }) {
  const translate = useTranslate();
  const meta = FILTER_META[filter.type];
  const set: SetFilter = (patch, options) => onChange({ ...filter, ...patch }, options.live);
  return (
    <div className="embed-editor_filter-editor">
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.filterFields.filter')}</span>
        <Select
          value={filter.type}
          options={typeOptions(translate)}
          onChange={(value) => {
            if (isFilterType(value)) {
              onChange(retypeFilter(value), false);
            }
          }}
          ariaLabel={translate('style.filterFields.filterType')}
          disabled={busy}
          searchable
        />
      </div>

      {meta.control === 'amount' ? (
        <ShadowLength
          label={translate('style.filterFields.amount')}
          value={filter.amount}
          range={{ min: meta.min, max: meta.max }}
          defaultUnit={meta.unit}
          busy={busy}
          onLive={(value) => set({ amount: value }, { live: true })}
          onCommit={(value) => set({ amount: value }, { live: false })}
        />
      ) : meta.control === 'angle' ? (
        <div className="embed-editor_size-row">
          <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.filterFields.angle')}</span>
          <AngleControl angle={filter.amount || '0deg'} busy={busy} onChange={(angle, live) => set({ amount: angle }, { live })} />
        </div>
      ) : (
        <DropShadowFields filter={filter} busy={busy} set={set} />
      )}
    </div>
  );
}

function DropShadowFields({ filter, busy, set }: { filter: Filter; busy: boolean; set: SetFilter }) {
  const translate = useTranslate();
  return (
    <>
      <ShadowLength
        label="X"
        value={filter.x}
        busy={busy}
        onLive={(value) => set({ x: value }, { live: true })}
        onCommit={(value) => set({ x: value }, { live: false })}
      />
      <ShadowLength
        label="Y"
        value={filter.y}
        busy={busy}
        onLive={(value) => set({ y: value }, { live: true })}
        onCommit={(value) => set({ y: value }, { live: false })}
      />
      <ShadowLength
        label={translate('style.filterFields.blur')}
        value={filter.blur}
        busy={busy}
        onLive={(value) => set({ blur: value }, { live: true })}
        onCommit={(value) => set({ blur: value }, { live: false })}
      />
      <ShadowColorRow color={filter.color} busy={busy} onChange={(color, live) => set({ color }, { live })} />
    </>
  );
}
