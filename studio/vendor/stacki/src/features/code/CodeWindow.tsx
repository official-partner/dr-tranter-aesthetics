import { useEffect, useRef } from 'react';
import Popup from '../../ui/Popup';
import { popupIsTop } from '../../ui/popupDismiss';
import type React from 'react';
import CodeEditor from '../../ui/CodeEditor';
import type { CodeEditorProps } from '../../ui/CodeEditor';
import { CloseIcon, CodeIcon } from '../../ui/Icons';
import { useWindowRectangle } from '../../ui/useWindowRectangle';
import { WindowResizeHandles } from '../../ui/WindowResizeHandles';
import { useTranslate } from '../../lib/i18n/useTranslate';

interface CodeWindowProps extends CodeEditorProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly editorKey?: React.Key | undefined;
  readonly overlay?: React.ReactNode;
}

export function codeWindowPinsHeaders(language: string | undefined): boolean {
  return language === 'css' || language === 'javascript' || language === 'typescript';
}

function useEscapeToClose(surface: React.RefObject<HTMLDivElement>, onClose: () => void): void {
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      if (!popupIsTop(surface.current)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [surface, onClose]);
}

export default function CodeWindow(props: CodeWindowProps) {
  const translate = useTranslate();
  const { title, language, indentation, value, onChange, onClose, editorKey, revealLine, revealSerial, extensions, overlay } = props;
  const windowState = useWindowRectangle({ width: 340, height: 220 });
  const { rectangle } = windowState;
  const surface = useRef<HTMLDivElement>(null);
  useEscapeToClose(surface, onClose);
  return (
    <Popup
      ref={surface}
      dismissible={false}
      mode="popover"
      portal={false}
      onClose={onClose}
      className="code-window"
      role="dialog"
      label={title}
      style={{
        left: rectangle.x,
        top: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
      }}
    >
      <div className="code-window-header" onPointerDown={(event) => windowState.start(event)}>
        <CodeIcon size={13} />
        <span className="code-window-title">{title}</span>
        <span className="type-tag">{language}</span>
        <span style={{ flex: 1 }} />
        <button className="ghost" title={translate('workspace.code.close')} onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="code-window-body">
        <CodeEditor
          key={editorKey}
          language={language}
          indentation={indentation}
          stickyHeaders={codeWindowPinsHeaders(language)}
          value={value}
          onChange={onChange}
          revealLine={revealLine}
          revealSerial={revealSerial}
          extensions={extensions}
        />
        {overlay}
      </div>
      <WindowResizeHandles windowState={windowState} />
    </Popup>
  );
}
