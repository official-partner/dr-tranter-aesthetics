import { assert } from '../../../shared/core/assert';
import { messageRef, type TypedMessageRef } from '../../../shared/properties/i18n/messageRef';
import { APP_GITHUB_CHOICE_LIMITS, parseGitHubRepositoryReference, type AppRepository } from '../../../shared/properties/apps';

export type ChooserRow =
  | { readonly kind: 'use'; readonly key: string; readonly owner: string; readonly repository: string }
  | { readonly kind: 'section'; readonly key: string; readonly label: string; readonly labelRef: TypedMessageRef }
  | { readonly kind: 'repository'; readonly key: string; readonly repository: AppRepository }
  | { readonly kind: 'notice'; readonly key: string; readonly notice: 'no-match' };

export type ChooserPickable = Extract<ChooserRow, { readonly kind: 'use' | 'repository' }>;

export interface ChooserInput {
  readonly query: string;
  readonly repositories: readonly AppRepository[] | undefined;
}

export function chooserRows(input: ChooserInput): readonly ChooserRow[] {
  const reference = parseGitHubRepositoryReference(input.query);
  const needle = reference === undefined ? input.query.trim().toLowerCase() : `${reference.owner}/${reference.repository}`.toLowerCase();
  const searching = needle.length > 0;
  const tagged = (input.repositories ?? []).slice(0, APP_GITHUB_CHOICE_LIMITS.repositoriesMax).filter((repository) => repository.stackiApp);
  const matches = searching ? tagged.filter((repository) => repositoryKey(repository).includes(needle)) : tagged;
  const rows: ChooserRow[] = [];
  if (reference !== undefined) {
    const key = `${reference.owner}/${reference.repository}`.toLowerCase();
    if (!matches.some((repository) => repositoryKey(repository) === key)) {
      rows.push({ kind: 'use', key: `use:${key}`, owner: reference.owner, repository: reference.repository });
    }
  }
  if (matches.length > 0) {
    rows.push({ kind: 'section', key: 'section:tagged', label: 'Stacki apps', labelRef: messageRef('apps.chooser.sectionStacki') });
    rows.push(...matches.map((repository) => repositoryRow(repository)));
  } else if (searching && tagged.length > 0) {
    rows.push({ kind: 'notice', key: 'notice:no-match', notice: 'no-match' });
  }
  assert(matches.length <= tagged.length, 'Rows come from the tagged repositories');
  assert(
    rows.every((row) => row.kind !== 'repository' || row.repository.stackiApp),
    'Only tagged repositories are listed',
  );
  return rows;
}

export function hasStackiApps(repositories: readonly AppRepository[]): boolean {
  return repositories.some((repository) => repository.stackiApp);
}

export function chooserPickables(rows: readonly ChooserRow[]): readonly ChooserPickable[] {
  const pickables = rows.filter((row): row is ChooserPickable => row.kind === 'use' || row.kind === 'repository');
  assert(pickables.length <= rows.length, 'Pickables are a subset of the rows');
  return pickables;
}

export function moveChooserActive(active: number, step: -1 | 1, count: number): number {
  assert(Number.isSafeInteger(active), 'The active row is an index');
  assert(Number.isSafeInteger(count), 'The row count is an integer');
  assert(count >= 0, 'The row count is not negative');
  if (count === 0) {
    return 0;
  }
  const next = Math.min(count - 1, Math.max(0, active + step));
  assert(next >= 0, 'The active row is not before the first');
  assert(next < count, 'The active row is not past the last');
  return next;
}

function repositoryKey(repository: AppRepository): string {
  return `${repository.owner}/${repository.name}`.toLowerCase();
}

function repositoryRow(repository: AppRepository): ChooserRow {
  return { kind: 'repository', key: `repository:${repositoryKey(repository)}`, repository };
}
