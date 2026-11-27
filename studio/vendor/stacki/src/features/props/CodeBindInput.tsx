import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { FocusEventHandler } from 'react';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { templateHoles, type Part, type TemplateHole } from '../../editor/bindings';
import ExprInput, { type ExprInputAPI } from '../../ui/ExprInput';
import type { AttributeLanguage } from '../../ui/attributeLanguage';
import type { BindInputHandle } from './BindInput';
import { propSyntax } from './propSyntax';
import { commitEditableInPlace } from '../../ui/commitInPlace';


export function partsText(parts: readonly Part[] | undefined): string {
  assert((parts?.length ?? 0) <= LIMITS.treeNodesMax, 'CodeBindInput: part limit exceeded');
  return (parts ?? []).map((part) => (part.expr === undefined ? (part.text ?? '') : `\${${part.expr}}`)).join('');
}

export function textParts(text: string): Part[] {
  assert(text.length <= LIMITS.attrCharsMax, 'CodeBindInput: value limit exceeded');
  const holes = templateHoles(text);
  assert(holes.length <= LIMITS.treeNodesMax, 'CodeBindInput: hole limit exceeded');
  const parts: Part[] = [];
  let position = 0;
  for (const hole of holes) {
    if (hole.from > position) {
      parts.push({ text: text.slice(position, hole.from) });
    }
    parts.push({ expr: hole.path });
    position = hole.to;
  }
  if (position < text.length) {
    parts.push({ text: text.slice(position) });
  }
  return parts;
}

export function partsHoldHoles(parts: readonly Part[] | undefined): boolean {
  return (parts ?? []).every((part) => part.text === undefined || !part.text.includes('${'));
}

interface CodeBindInputProps {
  readonly parts?: readonly Part[] | undefined;
  readonly language: AttributeLanguage;
  readonly placeholder?: string | undefined;
  readonly onChange?: (parts: Part[]) => void;
  readonly onChipClick?: (chip: TemplateHole) => void;
  readonly onFocus?: FocusEventHandler<HTMLDivElement>;
  readonly onBlur?: FocusEventHandler<HTMLDivElement>;
}

const CodeBindInput = forwardRef<BindInputHandle, CodeBindInputProps>(function CodeBindInput(props, ref) {
  const { parts, language, placeholder, onChange, onChipClick, onFocus, onBlur } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExprInputAPI | undefined>(undefined);
  const text = partsText(parts);
  useImperativeHandle(ref, () => ({
    insert(path) {
      apiRef.current?.insert(`\${${path}}`);
    },
    replace(chip, path) {
      if (chip !== undefined && 'from' in chip) {
        apiRef.current?.replaceRange(chip.from, chip.to, `\${${path}}`);
      }
    },
    focus() {
      hostRef.current?.querySelector<HTMLElement>('.cm-content')?.focus();
    },
  }));
  return (
    <div
      ref={hostRef}
      className="code-bind-input"
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          const content = hostRef.current?.querySelector<HTMLElement>('.cm-content');
          if (content) {
            commitEditableInPlace(content);
          }
        }
      }}
    >
      <ExprInput
        value={text}
        syncValue={text}
        syntax={propSyntax(language)}
        singleLine
        wrap
        placeholder={placeholder ?? ''}
        chipsOf={templateHoles}
        apiRef={apiRef}
        onChipClick={(hole) => hole !== undefined && onChipClick?.(hole)}
        onChange={(next) => onChange?.(textParts(next))}
      />
    </div>
  );
});

export default CodeBindInput;
