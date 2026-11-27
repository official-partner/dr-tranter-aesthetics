import type { ComponentProps } from 'react';
import GitChip from './GitChip';
import { GitSessionDialogs } from './GitSessionDialogs';
import { useGitSession, type GitHost } from './useGitSession';

type Props = GitHost & Omit<ComponentProps<typeof GitChip>, 'session'>;

export default function GitPanelControls({ incoming, withBranchChange, pullShortcut, ...host }: Props) {
  const session = useGitSession(host);
  return (
    <>
      <GitChip
        session={session}
        pullShortcut={pullShortcut}
        {...(incoming === undefined ? {} : { incoming })}
        {...(withBranchChange === undefined ? {} : { withBranchChange })}
      />
      <GitSessionDialogs session={session} />
    </>
  );
}
