
export const isExternalAsset = (value: unknown): boolean => {
  const text = String(value ?? '').trim();
  return /^(https?:)?\/\//.test(text) || /^(data|blob):/i.test(text);
};

const normalizeRel = (rel: string): string | undefined => {
  const out: string[] = [];
  for (const seg of String(rel).split('/')) {
    if (!seg || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (!out.length) {
        return undefined;
      }
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join('/') : undefined;
};

export function assetRelCandidates(value: unknown, baseDirectory?: string | undefined): readonly string[] {
  const raw = String(value ?? '').trim();
  if (!raw || isExternalAsset(raw)) {
    return [];
  }
  const path = (raw.split(/[?#]/)[0] ?? '').replace(/\\/g, '/');
  if (!path) {
    return [];
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return [];
  }

  const alias = path.match(/^[@~]\/(.+)$/);
  if (alias) {
    return [normalizeRel(`src/${alias[1]}`)].filter((value): value is string => Boolean(value));
  }

  if (path.startsWith('/')) {
    const rooted = path.startsWith('/src/') ? path.slice(1) : `public${path}`;
    return [normalizeRel(rooted)].filter((value): value is string => Boolean(value));
  }

  if (/^(public|src)\//.test(path)) {
    return [normalizeRel(path)].filter((value): value is string => Boolean(value));
  }

  const explicit = /^\.\.?\//.test(path);
  const guesses: (string | undefined)[] = [];
  if (baseDirectory) {
    guesses.push(normalizeRel(`${baseDirectory}/${path}`));
  }
  if (!explicit || !baseDirectory) {
    guesses.push(normalizeRel(`public/${path}`));
  }
  return guesses.filter((value): value is string => Boolean(value));
}

export const assetRelOf = (value: unknown, baseDirectory?: string): string | undefined => assetRelCandidates(value, baseDirectory)[0] || undefined;

export function relativeAssetPath(fromDirectory: string | undefined, toRel: string | undefined): string {
  const from = String(fromDirectory || '')
    .split('/')
    .filter((value): value is string => Boolean(value));
  const to = String(toRel || '')
    .split('/')
    .filter((value): value is string => Boolean(value));
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) {
    i++;
  }
  const up = from.slice(i).map(() => '..');
  const rest = to.slice(i).join('/');
  return up.length ? `${up.join('/')}/${rest}` : `./${rest}`;
}

export function assetValueFor(pickedRel: string | undefined, baseDirectory?: string | undefined): string {
  const rel = String(pickedRel || '').replace(/^\/+/, '');
  if (rel.startsWith('public/')) {
    return `/${rel.slice('public/'.length)}`;
  }
  if (baseDirectory) {
    return relativeAssetPath(baseDirectory, rel);
  }
  return `/${rel}`;
}
