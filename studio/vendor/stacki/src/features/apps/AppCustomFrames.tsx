import { useMemo } from 'react';
import type { AppSummary } from '../../../shared/properties/apps';
import Popup from '../../ui/Popup';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { CloseIcon } from '../../ui/Icons';
import { AppFrame } from './AppFrame';
import { AppTile } from './AppTile';
import { closeCustomFrame, useAppsRuntime, type CustomFrame } from './appsRuntime';
import './appFrames.css';

const FRAME_MARGIN_PX = 24;
const HEADER_HEIGHT_PX = 40;

export function AppCustomFrames() {
  const runtime = useAppsRuntime();
  const apps = new Map(runtime.running.map((running) => [running.app.manifest.id, running.app]));
  return (
    <>
      {runtime.frames.map((frame) => {
        const app = apps.get(frame.appId);
        return app === undefined ? undefined : <CustomFrameWindow key={frame.id} frame={frame} app={app} />;
      })}
    </>
  );
}

function CustomFrameWindow({ frame, app }: { readonly frame: CustomFrame; readonly app: AppSummary }) {
  const info = useMemo(() => ({ id: frame.id, data: frame.data }), [frame.id, frame.data]);
  const translate = useTranslate();
  const close = (): void => closeCustomFrame(frame.id, undefined);
  const size = fittedSize(frame);
  const labelId = `${frame.id}-title`;
  const body = (
    <>
      <header className="app-custom-frame-header">
        <AppTile manifest={app.manifest} size={18} />
        <h2 id={labelId}>{app.manifest.name}</h2>
        <button
          type="button"
          className="ghost apps-icon-button"
          onClick={close}
          title={translate('ui.close')}
          aria-label={translate('apps.frame.closeNamed', { name: app.manifest.name })}
        >
          <CloseIcon size={13} />
        </button>
      </header>
      <AppFrame app={app} path={frame.page} title={app.manifest.name} className="app-custom-frame-page" frame={info} />
    </>
  );
  if (frame.modal) {
    return (
      <Popup className="app-custom-frame" labelledBy={labelId} onClose={close} style={size}>
        {body}
      </Popup>
    );
  }
  return (
    <Popup
      mode="popover"
      dismissible={false}
      keepOnScroll
      className="app-custom-frame is-popup"
      role="dialog"
      labelledBy={labelId}
      onClose={close}
      style={{ ...size, left: centered(window.innerWidth, size.width), top: centered(window.innerHeight, size.height) }}
    >
      {body}
    </Popup>
  );
}

function fittedSize(frame: CustomFrame): { readonly width: number; readonly height: number } {
  const viewportWidth = typeof window === 'undefined' ? frame.width : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? frame.height : window.innerHeight;
  return {
    width: Math.max(0, Math.min(frame.width, viewportWidth - FRAME_MARGIN_PX * 2)),
    height: Math.max(0, Math.min(frame.height + HEADER_HEIGHT_PX, viewportHeight - FRAME_MARGIN_PX * 2)),
  };
}

function centered(viewportPx: number, sizePx: number): number {
  return Math.max(FRAME_MARGIN_PX, Math.floor((viewportPx - sizePx) / 2));
}
