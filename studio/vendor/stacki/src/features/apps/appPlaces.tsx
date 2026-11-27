import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { assert } from '../../../shared/core/assert';
import { APP_LIMITS, type AppSummary } from '../../../shared/properties/apps';
import { appListedInMarketplace, appPlacePills, type AppPill, type AppRepositoryPlace } from '../../../shared/properties/appPlace';
import { latestApprovedVersion, marketplaceApp, type MarketplaceIndex } from '../../../shared/properties/appMarketplace';
import { loadAppRepositoryPlace, loadMarketplace } from '../../ipc/appMarketplaceBridge';
import { appPublication, type AppPublication } from './publishFlow';
import { useTranslateRef } from '../../lib/i18n/useTranslate';
import { useDelayedTooltip } from '../../ui/delayedTooltip';

export interface AppPlaceFacts {
  readonly place: AppRepositoryPlace | undefined;
  readonly listed: boolean;
  readonly published: AppPublication | undefined;
  readonly listedVersion: string | undefined;
}

export const NO_APP_PLACE_FACTS: AppPlaceFacts = { place: undefined, listed: false, published: undefined, listedVersion: undefined };

export function useAppPlaces(projectPath: string, apps: readonly AppSummary[], options: { readonly marketplace: boolean }): ReadonlyMap<string, AppPlaceFacts> {
  const signature = useMemo(() => JSON.stringify(apps.map((app) => [app.manifest.id, app.lock.source, app.manifest.source])), [apps]);
  const marketplace = options.marketplace;
  const [facts, setFacts] = useState<ReadonlyMap<string, AppPlaceFacts>>(() => keptFacts(projectPath, { signature, marketplace }));
  useEffect(() => {
    if (apps.length === 0) {
      setFacts(new Map());
      return;
    }
    let current = true;
    void lookUpPlaces(projectPath, apps, { marketplace }).then((found) => {
      keepFacts(projectPath, { signature, marketplace, facts: found });
      if (current) {
        setFacts(found);
      }
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for `apps`: a reload with the same sources must not ask GitHub again.
  }, [projectPath, signature, marketplace]);
  return facts;
}

const KEPT_FACTS_PROJECTS_MAX = 8;
interface KeptFacts {
  readonly signature: string;
  readonly marketplace: boolean;
  readonly facts: ReadonlyMap<string, AppPlaceFacts>;
}
const keptFactsByProject = new Map<string, KeptFacts>();

function keptFacts(projectPath: string, lookup: Pick<KeptFacts, 'signature' | 'marketplace'>): ReadonlyMap<string, AppPlaceFacts> {
  const kept = keptFactsByProject.get(projectPath);
  if (kept === undefined) {
    return new Map();
  }
  if (kept.signature === lookup.signature) {
    if (kept.marketplace === lookup.marketplace) {
      return kept.facts;
    }
  }
  return new Map();
}

function keepFacts(projectPath: string, kept: KeptFacts): void {
  keptFactsByProject.delete(projectPath);
  keptFactsByProject.set(projectPath, kept);
  const oldest = keptFactsByProject.keys().next().value;
  if (keptFactsByProject.size > KEPT_FACTS_PROJECTS_MAX) {
    assert(oldest !== undefined, 'useAppPlaces: a full cache has an oldest project');
    keptFactsByProject.delete(oldest);
  }
  assert(keptFactsByProject.size <= KEPT_FACTS_PROJECTS_MAX, 'useAppPlaces: the kept facts stay within their bound');
}

export function AppPlacePills({ app, facts }: { readonly app: AppSummary; readonly facts: AppPlaceFacts }) {
  const pills = appPlacePills(app.lock.source, facts);
  return (
    <span className="apps-row-places">
      {pills.map((pill) => (
        <AppPlacePill key={pill.kind} pill={pill} />
      ))}
    </span>
  );
}

function AppPlacePill({ pill }: { readonly pill: AppPill }) {
  const tooltip = useDelayedTooltip();
  const translateRef = useTranslateRef();
  return (
    <>
      <span className="apps-badge muted apps-place-pill" data-place={pill.kind} onMouseEnter={tooltip.show} onMouseLeave={tooltip.hide}>
        {translateRef(pill.labelRef)}
      </span>
      {}
      {tooltip.value !== undefined &&
        createPortal(
          <div className="rail-tooltip below" role="tooltip" style={tooltip.value}>
            {translateRef(pill.tooltipRef)}
          </div>,
          document.body,
        )}
    </>
  );
}

function onGitHub(app: AppSummary): boolean {
  const kind = app.lock.source.kind;
  return kind === 'github' || kind === 'marketplace';
}

async function lookUpPlaces(
  projectPath: string,
  apps: readonly AppSummary[],
  options: { readonly marketplace: boolean },
): Promise<ReadonlyMap<string, AppPlaceFacts>> {
  assert(apps.length <= APP_LIMITS.appsMax, 'Place lookups are bounded by the installed apps');
  const [index, places] = await Promise.all([
    options.marketplace ? readIndex(projectPath) : Promise.resolve(undefined),
    Promise.all(apps.map((app) => (onGitHub(app) ? readPlace(projectPath, app.manifest.id) : Promise.resolve(undefined)))),
  ]);
  const found = new Map<string, AppPlaceFacts>();
  apps.forEach((app, position) => {
    const listed = index === undefined ? false : appListedInMarketplace(index, { id: app.manifest.id, source: app.lock.source });
    const published = appPublication(app, index);
    found.set(app.manifest.id, {
      place: places[position],
      listed,
      published,
      listedVersion: listedVersionOf(index, app, { listed: listed || published?.listed === true }),
    });
  });
  assert(found.size <= apps.length, 'One entry per app');
  return found;
}

function listedVersionOf(index: MarketplaceIndex | undefined, app: AppSummary, state: { readonly listed: boolean }): string | undefined {
  if (index === undefined) {
    return undefined;
  }
  if (!state.listed) {
    return undefined;
  }
  const listing = marketplaceApp(index, app.manifest.id);
  assert(listing !== undefined, 'A listed app has its listing');
  return latestApprovedVersion(listing).version;
}

async function readIndex(projectPath: string): Promise<MarketplaceIndex | undefined> {
  try {
    const answer = await loadMarketplace(projectPath, { refresh: false });
    return answer.ok ? answer.value : undefined;
  } catch {
    return undefined;
  }
}

async function readPlace(projectPath: string, id: string): Promise<AppRepositoryPlace | undefined> {
  try {
    const answer = await loadAppRepositoryPlace(projectPath, id);
    return answer.ok ? answer.value.place : undefined;
  } catch {
    return undefined;
  }
}
