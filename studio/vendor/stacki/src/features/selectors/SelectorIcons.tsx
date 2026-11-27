import { centralIcon } from '../../ui/central/CentralIcon';
import { lock as centralLock, styles as centralStyles, sweep as centralSweep, unlock as centralUnlock } from '../../ui/central/centralGeometry';
import type { IconProps } from '../../ui/IconBase';

export const StyleSelectorsIcon = centralIcon(centralStyles, 20);
export const SweepIcon = centralIcon(centralSweep);

const ClosedLockIcon = centralIcon(centralLock);
const OpenLockIcon = centralIcon(centralUnlock);

export function LockIcon({ open, ...props }: Pick<IconProps, 'size' | 'className' | 'style'> & { readonly open: boolean }) {
  const className = `selectors-lock-icon${open ? ' is-open' : ''}${props.className === undefined ? '' : ` ${props.className}`}`;
  return open ? <OpenLockIcon {...props} className={className} /> : <ClosedLockIcon {...props} className={className} />;
}
