
import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import useListReorder from '../../ui/useListReorder';
import ExprInput from '../../ui/ExprInput';
import { useCodeAccess } from '../../ui/CodeAccess';
import { BracesIcon, DragIcon, TrashIcon } from '../../ui/Icons';
import { assert } from '../../../shared/core/assert';
import { isArrayLiteral, LOOP_LITERAL_LIMITS } from '../../editor/loopLiteral';
import { SectionHeader } from './LoopRows';
import { moved } from './LoopItems';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { commitInPlace } from '../../ui/commitInPlace';

export function LiteralItemsSection(props: {
  readonly items: readonly string[] | undefined;
  readonly data: string;
  readonly onChange: (items: readonly string[]) => void;
  readonly onCode: (code: string) => string | undefined;
}) {
  const translate = useTranslate();
  const access = useCodeAccess();
  const { items } = props;
  const [open, setOpen] = useState(items === undefined);
  useEffect(() => {
    if (items === undefined) {
      setOpen(true);
    }
  }, [items]);
  const shown = open || items === undefined;
  const toggle = access ? (
    <button
      type="button"
      className={`prop-expr-toggle${shown ? ' on' : ''}`}
      title={
        items === undefined
          ? translate('props.loop.literal.areCode')
          : shown
            ? translate('props.loop.literal.useRows')
            : translate('props.loop.literal.writeCode')
      }
      aria-pressed={shown}
      aria-label={translate('props.loop.literal.itemsAsCode')}
      disabled={items === undefined}
      onClick={() => setOpen(!shown)}
    >
      <BracesIcon size={12} />
    </button>
  ) : undefined;
  if (shown) {
    return (
      <div className="loop-settings-section">
        <SectionHeader title={translate('props.loop.literal.items')} addable={false} toggle={toggle} onAdd={() => undefined} />
        <ItemsCode data={props.data} onCode={props.onCode} />
      </div>
    );
  }
  return <ItemRows {...props} items={items ?? []} toggle={toggle} />;
}

function ItemsCode(props: { readonly data: string; readonly onCode: (code: string) => string | undefined }) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(props.data);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDraft(props.data);
    setProblem(undefined);
  }, [props.data]);
  const commit = (text: string): boolean => {
    const next = text.trim();
    if (next === props.data.trim()) {
      setProblem(undefined);
      return true;
    }
    if (!isArrayLiteral(next)) {
      setProblem(translate('props.loop.literal.notList'));
      return false;
    }
    const found = props.onCode(next);
    setProblem(found);
    return found === undefined;
  };
  return (
    <>
      <div className="loop-section-code">
        <ExprInput
          value={draft}
          syncValue={props.data}
          placeholder={translate('props.loop.literal.placeholder')}
          invalid={problem !== undefined}
          multiline={true}
          wrap={true}
          completions={[]}
          onChange={(text) => {
            setDraft(text);
            setProblem(undefined);
          }}
          onCommit={commit}
        />
      </div>
      <ErrorToast message={problem} />
    </>
  );
}

function ItemRows(props: { readonly items: readonly string[]; readonly toggle: React.ReactNode; readonly onChange: (items: readonly string[]) => void }) {
  const translate = useTranslate();
  const { items } = props;
  const write = (next: readonly string[]): void => {
    assert(next.length <= LOOP_LITERAL_LIMITS.itemsMax, 'A typed list is bounded');
    props.onChange(next);
  };
  const reorder = useListReorder({ count: items.length, onMove: (source, target) => write(moved(items, source, target)) });
  return (
    <div className="loop-settings-section">
      <SectionHeader
        title={translate('props.loop.literal.items')}
        addable={items.length < LOOP_LITERAL_LIMITS.itemsMax}
        toggle={props.toggle}
        onAdd={() => write([...items, translate('props.loop.literal.newItem', { number: items.length + 1 })])}
      />
      {items.length > 0 ? (
        <div className="loop-settings-list">
          {items.map((item, index) => (
            <div
              key={`${index}:${item}`}
              {...reorder.rowProps(index)}
              className={`loop-settings-item loop-settings-picked ${reorder.rowClass(index)}`}
            >
              <span className="loop-settings-item-drag" aria-hidden="true">
                <DragIcon size={12} />
              </span>
              <LiteralInput value={item} onCommit={(value) => write(items.map((entry, at) => (at === index ? value : entry)))} />
              <button
                type="button"
                className="loop-settings-item-remove"
                aria-label={translate('props.loop.items.remove')}
                title={translate('ui.remove')}
                onClick={() => write(items.filter((_, at) => at !== index))}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="loop-settings-empty">{translate('props.loop.literal.empty')}</div>
      )}
    </div>
  );
}

function LiteralInput(props: { readonly value: string; readonly onCommit: (value: string) => void }) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(props.value);
  const commit = (): void => {
    if (draft === props.value) {
      return;
    }
    props.onCommit(draft);
  };
  return (
    <input
      className="loop-settings-literal-input"
      value={draft}
      maxLength={LOOP_LITERAL_LIMITS.itemCharsMax}
      spellCheck={false}
      aria-label={translate('props.loop.literal.item')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commitInPlace(event.currentTarget);
        } else if (event.key === 'Escape') {
          setDraft(props.value);
        }
      }}
    />
  );
}
