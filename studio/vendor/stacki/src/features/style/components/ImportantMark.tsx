import type { ReactNode } from 'react';


export function ImportantBadge() {
  return (
    <span className="embed-editor_important-badge" role="img" aria-label="!important" title="!important">
      !
    </span>
  );
}

export default function ImportantMark({ important, children }: { readonly important: boolean; readonly children: ReactNode }) {
  if (!important) {
    return children;
  }
  return (
    <div className="embed-editor_important-mark">
      {children}
      <ImportantBadge />
    </div>
  );
}
