const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function pageRank(name: unknown): 0 | 1 | 2 {
  const base = String(name || '').replace(/\.(astro|mdx?)$/i, '');
  if (/^index$/i.test(base)) {
    return 0;
  }
  if (/^\d/.test(base)) {
    return 2;
  }
  return 1;
}

export function comparePageNames(left: unknown, right: unknown): number {
  const leftName = String(left || '').replace(/\.(astro|mdx?)$/i, '');
  const rightName = String(right || '').replace(/\.(astro|mdx?)$/i, '');
  return pageRank(leftName) - pageRank(rightName) || collator.compare(leftName, rightName);
}

export function leadsFolders(name: unknown): boolean {
  return pageRank(name) === 0;
}

export function isCollectionRoute(name: unknown): boolean {
  return /\[[^\]]*\]/.test(String(name || ''));
}
