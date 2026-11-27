
import { useEffect } from 'react';
import { DEFAULT_NEW_STYLE_LOCATIONS } from '../../../../shared/properties/newStyleLocations';
import { readNewStyleLocations } from '../../../ipc/newStyleTagBridge';
import { getHost } from '../model/host';
import { publishNewStyleLocations } from '../model/newStyleTagSettings';

export function useNewStyleTagSettings(): void {
  const projectPath = getHost().projectPath;
  useEffect(() => {
    if (projectPath === undefined) {
      publishNewStyleLocations(DEFAULT_NEW_STYLE_LOCATIONS);
      return undefined;
    }
    let live = true;
    const load = (): void => {
      readNewStyleLocations(projectPath).then(
        (locations) => {
          if (live) {
            publishNewStyleLocations(locations);
          }
        },
        () => {
        },
      );
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, [projectPath]);
}
