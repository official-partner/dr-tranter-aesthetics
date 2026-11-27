import { useEffect, useRef } from 'react';
import type { AppSummary } from '../../../shared/properties/apps';
import type { AppFrameInfo } from '../../../shared/properties/appsRpc';
import { APP_FRAME_SURFACE } from '../../../shared/properties/appUiKit';
import { appFrameURL } from '../../ipc/appsBridge';
import { appFrameReloaded, attachAppFrame } from './appsRuntime';
import { useAppFileRevision } from './appFileRevisions';

export const APP_FRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

export function AppFrame({
  app,
  path,
  title,
  className,
  interactive = true,
  frame,
  overlayItem,
}: {
  readonly app: AppSummary;
  readonly path?: string;
  readonly title: string;
  readonly className?: string;
  readonly interactive?: boolean;
  readonly frame?: AppFrameInfo;
  readonly overlayItem?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  useEffect(() => {
    const target = frameRef.current?.contentWindow ?? undefined;
    if (target === undefined) {
      return undefined;
    }
    return attachAppFrame(target, app, frame, overlayItem);
  }, [app, frame, overlayItem]);
  const revision = useAppFileRevision(app.manifest.id);
  const shownRevision = useRef(revision);
  useEffect(() => {
    if (revision === shownRevision.current) {
      return;
    }
    shownRevision.current = revision;
    const element = frameRef.current ?? undefined;
    if (element !== undefined) {
      element.src = appFrameURL(app.manifest.id, path ?? app.manifest.entry);
    }
  }, [revision, app, path]);
  const loaded = (): void => {
    loads.current += 1;
    const target = frameRef.current?.contentWindow ?? undefined;
    if (loads.current > 1 && target !== undefined) {
      appFrameReloaded(target);
    }
  };
  return (
    <iframe
      ref={frameRef}
      className={className}
      title={title}
      src={appFrameURL(app.manifest.id, path ?? app.manifest.entry)}
      sandbox={APP_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      allow=""
      style={{ ...APP_FRAME_SURFACE, pointerEvents: interactive ? undefined : 'none' }}
      onLoad={loaded}
    />
  );
}
