import { useEffect, useState } from 'react';
import { EmDashIcon } from '../../ui/Icons';
import { EMDASH_HOST, readEmDashProject } from '../../ipc/emdashBridge';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { EmDashProject } from '../../../shared/properties/emdash';
import { EmDashDialog } from './EmDashDialog';

export function EmDashButton({ projectPath }: { readonly projectPath: string }) {
  const translate = useTranslate();
  const [project, setProject] = useState<EmDashProject | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let current = true;
    if (EMDASH_HOST.available) {
      readEmDashProject(projectPath).then(
        (found) => current && setProject(found),
        () => current && setProject({ kind: 'absent' }),
      );
    }
    return () => {
      current = false;
    };
  }, [projectPath]);
  if (!EMDASH_HOST.available) {
    return <></>;
  }
  return (
    <>
      <button
        type="button"
        data-cms="emdash"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        <span className="cms-connect-icon">
          <EmDashIcon size={14} />
          {project?.kind === 'present' && <span className="cms-connect-status" role="img" aria-label={translate('emdash.button.connected')} />}
        </span>
        {}
        EmDash
      </button>
      {open && <EmDashDialog projectPath={projectPath} project={project} onProject={setProject} onClose={() => setOpen(false)} />}
    </>
  );
}
