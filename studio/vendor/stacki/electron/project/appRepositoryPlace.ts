import { assert } from '../../shared/core/assert';
import { described } from '../../shared/properties/i18n/messageRef';
import { appsFailure, type AppSummary, type AppsResult } from '../../shared/properties/apps';
import type { MarketplaceIndex } from '../../shared/properties/appMarketplace';
import {
  APP_PLACE_LIMITS,
  appRepositoryLocation,
  type AppRepositoryLocation,
  type AppRepositoryPlaceReply,
  type AppRepositoryVisibility,
} from '../../shared/properties/appPlace';
import { repositoryVisibility, type GitHubFetch } from './appGitHub';
import { listInstalledApps } from './appStore';

export interface AppRepositoryPlaceOptions {
  readonly fetch: GitHubFetch;
  readonly now: () => number;
  readonly tokenFor: ((account: string) => Promise<string>) | undefined;
  readonly marketplace: () => Promise<MarketplaceIndex | undefined>;
}

interface CacheEntry {
  readonly answer: Promise<AppRepositoryVisibility | undefined>;
  readonly expiresAtMs: number;
}

export function createAppRepositoryPlaces(options: AppRepositoryPlaceOptions) {
  const cache = new Map<string, CacheEntry>();

  const remember = (key: string, entry: CacheEntry): void => {
    cache.delete(key);
    if (cache.size >= APP_PLACE_LIMITS.visibilityReposMax) {
      const now = options.now();
      for (const [stale, held] of cache) {
        if (held.expiresAtMs <= now) {
          cache.delete(stale);
        }
      }
    }
    if (cache.size >= APP_PLACE_LIMITS.visibilityReposMax) {
      const oldest = cache.keys().next();
      assert(oldest.done !== true, 'A full cache has an oldest entry');
      cache.delete(oldest.value);
    }
    cache.set(key, entry);
    assert(cache.size <= APP_PLACE_LIMITS.visibilityReposMax, 'The visibility cache is bounded');
  };

  const ask = async (location: AppRepositoryLocation): Promise<AppRepositoryVisibility | undefined> => {
    let token: string | undefined;
    if (location.account !== undefined && options.tokenFor !== undefined) {
      try {
        token = await options.tokenFor(location.account);
      } catch {
        token = undefined;
      }
    }
    try {
      return await repositoryVisibility(options.fetch, location.owner, location.repository, token);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Assertion failed')) {
        throw error;
      }
      return undefined;
    }
  };

  const visibility = (location: AppRepositoryLocation): Promise<AppRepositoryVisibility | undefined> => {
    assert(location.owner.length > 0, 'A repository has an owner');
    assert(location.repository.length > 0, 'A repository has a name');
    const key = `${location.account ?? ''}:${location.owner}/${location.repository}`.toLowerCase();
    const held = cache.get(key);
    if (held !== undefined) {
      if (options.now() < held.expiresAtMs) {
        return held.answer;
      }
    }
    const answer = ask(location);
    remember(key, { answer, expiresAtMs: options.now() + APP_PLACE_LIMITS.visibilityCacheMsMax });
    void answer.then((settled) => {
      if (settled === undefined && cache.get(key)?.answer === answer) {
        remember(key, { answer, expiresAtMs: options.now() + APP_PLACE_LIMITS.visibilityFailureMsMax });
      }
    });
    return answer;
  };

  return {
    visibility,
    place: async (projectRoot: string, id: string): Promise<AppsResult<AppRepositoryPlaceReply>> => {
      assert(id.length > 0, 'An app id to look up is never empty');
      const installed = installedApp(projectRoot, id);
      if (!installed.ok) {
        return installed;
      }
      const app = installed.value;
      const index = app.lock.source.kind === 'marketplace' ? await options.marketplace() : undefined;
      const location = appRepositoryLocation(app.lock.source, index);
      if (location === undefined) {
        return { ok: true, value: { place: undefined } };
      }
      const found = await visibility(location);
      return { ok: true, value: { place: { owner: location.owner, repository: location.repository, visibility: found } } };
    },
  };
}

export type AppRepositoryPlaces = ReturnType<typeof createAppRepositoryPlaces>;

function installedApp(projectRoot: string, id: string): AppsResult<AppSummary> {
  try {
    const app = listInstalledApps(projectRoot).find((summary) => summary.manifest.id === id);
    if (app === undefined) {
      return { ok: false, ...described('apps.error.notInstalled', { id }) };
    }
    assert(app.manifest.id === id, 'The found app is the one asked for');
    return { ok: true, value: app };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Assertion failed')) {
      throw error;
    }
    return { ok: false, ...appsFailure(error) };
  }
}
