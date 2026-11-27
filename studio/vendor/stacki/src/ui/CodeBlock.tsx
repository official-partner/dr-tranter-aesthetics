import React, { useEffect, useMemo, useState } from 'react';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { astroCodeLineBatches, astroCodeLinesNow } from './astroHighlight';
import { codeLineBatches, codeTokenLines, languageFor, plainCodeLines, type CodeLanguage, type CodeLine } from './codeHighlight';
import './codeBlock.css';


interface CodeProps {
  readonly text: string;
  readonly language?: CodeLanguage | undefined;
  readonly filename?: string | undefined;
  readonly className?: string | undefined;
}

export function CodeBlock({ text, language, filename, className, label }: CodeProps & { readonly label?: string | undefined }) {
  const lines = useCodeLines(text, language ?? languageFor(filename));
  const focus = label === undefined ? {} : { 'aria-label': label, tabIndex: 0 };
  return (
    <pre className={codeClassName('code-block', className)} {...focus}>
      <code>
        <CodeLines lines={lines} />
      </code>
    </pre>
  );
}

export function CodeInline({ text, language, filename, className }: CodeProps) {
  const lines = useCodeLines(text, language ?? languageFor(filename));
  return (
    <code className={codeClassName('code-inline', className)}>
      <CodeLines lines={lines} />
    </code>
  );
}

export function CodeTokens({ line }: { readonly line: CodeLine | undefined }) {
  return line?.map((token, index) =>
    token.style === undefined ? (
      <React.Fragment key={index}>{token.text}</React.Fragment>
    ) : (
      <span key={index} className="code-token" style={token.style}>
        {token.text}
      </span>
    ),
  );
}

export function useCodeLines(text: string, language: CodeLanguage | undefined): readonly CodeLine[] {
  const [grown, setGrown] = useState<{ readonly text: string; readonly language: CodeLanguage | undefined; readonly lines: readonly CodeLine[] }>();
  const now = useMemo(() => {
    if (text.length > LIMITS.syntaxHighlightSliceCharsMax) {
      return undefined;
    }
    return language === 'astro' ? astroCodeLinesNow(text) : codeTokenLines(text, language);
  }, [text, language]);
  const plain = useMemo(() => plainCodeLines(text), [text]);
  useEffect(() => {
    if (now !== undefined || language === undefined) {
      return;
    }
    const stopper = new AbortController();
    colourInBatches(text, language, { plain, signal: stopper.signal }, (lines) => {
      setGrown({ text, language, lines });
    }).catch((error: unknown) => {
      console.error('Syntax highlighting failed', error);
    });
    return () => {
      stopper.abort();
    };
  }, [text, language, now, plain]);
  if (now !== undefined) {
    return now;
  }
  return grown?.text === text && grown.language === language ? grown.lines : plain;
}

async function colourInBatches(
  text: string,
  language: CodeLanguage,
  context: { readonly plain: readonly CodeLine[]; readonly signal: AbortSignal },
  publish: (lines: readonly CodeLine[]) => void,
): Promise<void> {
  const { plain, signal } = context;
  const batches = language === 'astro' ? astroCodeLineBatches(text) : codeLineBatches(text, language);
  const coloured: CodeLine[] = [];
  let publishAt = 1;
  for await (const batch of batches) {
    if (signal.aborted) {
      return;
    }
    for (const line of batch) {
      coloured.push(line);
    }
    if (coloured.length >= publishAt) {
      publish([...coloured, ...plain.slice(coloured.length)]);
      publishAt = coloured.length * 2;
    }
  }
  assert(coloured.length === plain.length, 'colourInBatches: the coloured lines are the lines of the text');
  publish(coloured);
}

function CodeLines({ lines }: { readonly lines: readonly CodeLine[] }) {
  return lines.map((line, index) => (
    <React.Fragment key={index}>
      {index > 0 && '\n'}
      <CodeTokens line={line} />
    </React.Fragment>
  ));
}

function codeClassName(base: string, className: string | undefined): string {
  return className === undefined ? base : `${base} ${className}`;
}
