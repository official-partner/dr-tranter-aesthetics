import { useEffect, useState } from 'react';
import { assert } from '../../shared/core/assert';

export const FONT_PREVIEW_EXTENSIONS = /\.(woff2?|ttf|otf)$/i;

export const FONT_FACES_MAX = 48;
const FONT_SOURCES_MAX = 4;

interface HeldFace {
  readonly family: string;
  readonly load: Promise<FontFace | undefined>;
  holders: number;
}

const held = new Map<string, HeldFace>();
let familyCount = 0;

export function acquireFontPreview(key: string, sources: readonly string[]): Promise<string | undefined> {
  assert(key.length > 0, 'A font preview has a key');
  assert(sources.length <= FONT_SOURCES_MAX, 'A font is tried from a bounded set of sources');
  const existing = held.get(key);
  if (existing !== undefined) {
    existing.holders++;
    return existing.load.then((face) => (face === undefined ? undefined : existing.family));
  }
  if (held.size >= FONT_FACES_MAX) {
    return Promise.resolve(undefined);
  }
  familyCount++;
  const family = `stacki-font-preview-${familyCount}`;
  const entry: HeldFace = { family, load: loadFace(family, sources), holders: 1 };
  held.set(key, entry);
  assert(held.size <= FONT_FACES_MAX, 'Held font faces stay within their cap');
  return entry.load.then((face) => {
    if (held.get(key) !== entry && face !== undefined) {
      document.fonts.delete(face);
    }
    return face === undefined ? undefined : family;
  });
}

export function releaseFontPreview(key: string): void {
  const entry = held.get(key);
  if (entry === undefined) {
    return;
  }
  entry.holders--;
  assert(entry.holders >= 0, 'A font preview is released no more often than acquired');
  if (entry.holders === 0) {
    held.delete(key);
    void entry.load.then((face) => {
      if (face !== undefined) {
        document.fonts.delete(face);
      }
    });
  }
}

export function heldFontPreviewCount(): number {
  return held.size;
}

async function loadFace(family: string, sources: readonly string[]): Promise<FontFace | undefined> {
  for (const source of new Set(sources)) {
    try {
      const face = new FontFace(family, `url("${source.replace(/"/g, '%22')}")`);
      await face.load();
      document.fonts.add(face);
      return face;
    } catch {
    }
  }
  return undefined;
}

export function useFontPreview(key: string | undefined, sources: readonly string[]): string | undefined {
  const [family, setFamily] = useState<string | undefined>(undefined);
  const sourceKey = sources.join('\n');
  useEffect(() => {
    setFamily(undefined);
    if (key === undefined) {
      return undefined;
    }
    let alive = true;
    void acquireFontPreview(key, sourceKey.split('\n')).then((loaded) => {
      if (alive) {
        setFamily(loaded);
      }
    });
    return () => {
      alive = false;
      releaseFontPreview(key);
    };
  }, [key, sourceKey]);
  return family;
}
