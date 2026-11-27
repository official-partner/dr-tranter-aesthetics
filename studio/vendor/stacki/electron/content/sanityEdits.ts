
import { randomUUID } from 'node:crypto';
import { assert } from '../../shared/core/assert';
import type { RemoteDocumentAction, RemoteDocumentSummary, RemoteMove } from '../../shared/properties/cmsRemote';
import { sanityQuery, sanityRequest, type SanityDataset } from './sanityContent';
import { isRank, rankBetween } from './sanityRank';

type SanityAction = Readonly<Record<string, unknown>>;

export async function sanityCreateDraft(target: SanityDataset, type: string, ordered: { readonly orderable: boolean }): Promise<RemoteDocumentSummary> {
  const id = randomUUID();
  const last = ordered.orderable ? await lastRank(target, type) : undefined;
  const attributes = {
    _id: `drafts.${id}`,
    _type: type,
    ...(ordered.orderable ? { orderRank: rankBetween(last, undefined) } : {}),
  };
  await sanityRequest(target, `actions/${target.dataset}`, {
    actions: [
      {
        actionType: 'sanity.action.document.create',
        publishedId: id,
        attributes,
        ifExists: 'fail',
      },
    ],
  });
  return {
    id,
    title: 'Untitled',
    subtitle: undefined,
    imageURL: undefined,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

export async function sanityDelete(target: SanityDataset, ids: readonly string[]): Promise<number> {
  assert(ids.length > 0, 'A delete names documents');
  const existing = await existingIds(target, ids);
  const actions = ids.flatMap((id): SanityAction[] => {
    const published = existing.has(id);
    const draft = existing.has(`drafts.${id}`);
    if (published) {
      return [
        {
          actionType: 'sanity.action.document.delete',
          publishedId: id,
          includeDrafts: draft ? [`drafts.${id}`] : [],
        },
      ];
    }
    return draft ? [{ actionType: 'sanity.action.document.discard', draftId: `drafts.${id}` }] : [];
  });
  if (actions.length > 0) {
    await sanityRequest(target, `actions/${target.dataset}`, { actions });
  }
  return actions.length;
}

export async function sanityMove(target: SanityDataset, move: RemoteMove): Promise<void> {
  const neighbours = [move.after, move.before].filter((id): id is string => id !== undefined);
  const ranks = await ranksOf(target, neighbours);
  const after = move.after === undefined ? undefined : ranks.get(move.after);
  const before = move.before === undefined ? undefined : ranks.get(move.before);
  if (move.after !== undefined && after === undefined) {
    throw new Error('The list changed in Sanity. Reopen it and try again.');
  }
  if (move.before !== undefined && before === undefined) {
    throw new Error('The list changed in Sanity. Reopen it and try again.');
  }
  const orderRank = rankBetween(after, before);
  const existing = await existingIds(target, [move.id]);
  const patches = [move.id, `drafts.${move.id}`].filter((id) => existing.has(id)).map((id) => ({ patch: { id, set: { orderRank } } }));
  assert(patches.length > 0, 'A moved document exists');
  await sanityRequest(target, `mutate/${target.dataset}`, { mutations: patches });
}

async function existingIds(target: SanityDataset, ids: readonly string[]): Promise<Set<string>> {
  const all = ids.flatMap((id) => [id, `drafts.${id}`]);
  const found = await sanityQuery(target, '*[_id in $ids]._id', { ids: all }, 'raw');
  return new Set(Array.isArray(found) ? found.filter((id) => typeof id === 'string') : []);
}

async function ranksOf(target: SanityDataset, ids: readonly string[]): Promise<Map<string, string>> {
  const all = ids.flatMap((id) => [id, `drafts.${id}`]);
  const rows = await sanityQuery(target, '*[_id in $ids]{_id, orderRank}', { ids: all }, 'raw');
  const ranks = new Map<string, string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id: unknown = typeof row === 'object' && row !== null ? Reflect.get(row, '_id') : undefined;
    const rank: unknown = typeof row === 'object' && row !== null ? Reflect.get(row, 'orderRank') : undefined;
    if (typeof id === 'string' && isRank(rank)) {
      const published = id.replace(/^drafts\./, '');
      if (!ranks.has(published) || id === published) {
        ranks.set(published, rank);
      }
    }
  }
  return ranks;
}

async function lastRank(target: SanityDataset, type: string): Promise<string | undefined> {
  const rank = await sanityQuery(target, '*[_type == $type && defined(orderRank)] | order(orderRank desc) [0].orderRank', { type }, 'raw');
  return isRank(rank) ? rank : undefined;
}

export async function sanityAct(target: SanityDataset, id: string, action: RemoteDocumentAction): Promise<void> {
  assert(!id.startsWith('drafts.'), 'An action names the published id');
  const existing = await existingIds(target, [id]);
  const draft = existing.has(`drafts.${id}`);
  const published = existing.has(id);
  const request = actionRequest(id, action, { draft, published });
  assert(request.actionType.startsWith('sanity.action.document.'), 'An action is Sanity’s own');
  await sanityRequest(target, `actions/${target.dataset}`, { actions: [request] });
}

function actionRequest(
  id: string,
  action: RemoteDocumentAction,
  has: { readonly draft: boolean; readonly published: boolean },
): { readonly actionType: string } & SanityAction {
  switch (action) {
    case 'publish':
      if (!has.draft) {
        throw new Error('There are no changes to publish.');
      }
      return {
        actionType: 'sanity.action.document.publish',
        draftId: `drafts.${id}`,
        publishedId: id,
      };
    case 'discard':
      if (!has.draft) {
        throw new Error('There are no changes to discard.');
      }
      return { actionType: 'sanity.action.document.discard', draftId: `drafts.${id}` };
    case 'unpublish':
      if (!has.published) {
        throw new Error('This item is not published.');
      }
      return {
        actionType: 'sanity.action.document.unpublish',
        draftId: `drafts.${id}`,
        publishedId: id,
      };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
