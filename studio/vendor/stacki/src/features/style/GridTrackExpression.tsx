import { useEffect, useRef, useState } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { commitInPlace } from './model/commitStyleInPlace';
import { checkTrackExpression, type TrackExpressionProblem } from './model/gridTemplate';
import VariableConnect from './VariableConnect';


export interface GridTrackExpressionProps {
  readonly value: string;
  readonly prop: string;
  readonly ariaLabel: string;
  readonly busy: boolean;
  readonly onCommit: (value: string, important: boolean) => void;
}

function problemKey(problem: TrackExpressionProblem): 'style.gridControls.trackExpressionEmpty' | 'style.gridControls.trackExpressionMalformed' {
  switch (problem) {
    case 'empty':
      return 'style.gridControls.trackExpressionEmpty';
    case 'malformed':
      return 'style.gridControls.trackExpressionMalformed';
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}

export default function GridTrackExpression(props: GridTrackExpressionProps) {
  const { value, prop, ariaLabel, busy, onCommit } = props;
  const translate = useTranslate();
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const focused = useRef(false);
  const change = (next: string) => {
    draftRef.current = next;
    setDraft(next);
  };
  useEffect(() => {
    if (!focused.current) {
      draftRef.current = value;
      setDraft(value);
    }
  }, [value]);
  const edited = draft.trim() !== value.trim();
  const check = checkTrackExpression(draft);
  const problem = edited && check.kind === 'invalid' ? check.problem : undefined;
  const commit = (text: string) => {
    if (text.trim() === value.trim()) {
      return;
    }
    const checked = checkTrackExpression(text);
    if (checked.kind === 'ok') {
      onCommit(checked.value, checked.important);
    }
  };
  return (
    <div className={`embed-editor_grid-count is-expression ${problem === undefined ? '' : 'is-invalid'}`}>
      <VariableConnect
        code
        ariaLabel={translate('style.gridControls.connectTracks', { name: ariaLabel })}
        disabled={busy}
        prop={prop}
        canvasProperty={prop}
        onPick={(binding) => {
          change(binding);
          commit(binding);
        }}
      >
        <input
          className="u-input embed-editor_size-input"
          value={draft}
          spellCheck={false}
          disabled={busy}
          aria-label={ariaLabel}
          aria-invalid={problem !== undefined}
          title={problem === undefined ? value : translate(problemKey(problem))}
          onChange={(event) => change(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit(draftRef.current);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitInPlace(event.currentTarget);
            } else if (event.key === 'Escape' && edited) {
              event.stopPropagation();
              change(value);
            }
          }}
        />
      </VariableConnect>
    </div>
  );
}
