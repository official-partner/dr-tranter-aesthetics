
import { assert } from '../../../shared/core/assert';
import { described, type Described } from '../../../shared/properties/i18n/messageRef';
import { MEDIA_HOSTING_LIMITS, parseMediaName, type BunnyRegion, type MediaConnection } from '../../../shared/properties/mediaHosting';
import { MEDIA_HTTP_LIMITS, MediaHostError, expectOk, readBounded, readText, send, statusProblem, type MediaFetch, type MediaRequest } from './mediaHttp';
import { contentTypeOf, publicURLOf, type MediaStore, type StoredFile } from './mediaStore';
import { sha256Hex } from './sigV4';

type BunnyConnection = Extract<MediaConnection, { readonly kind: 'bunny' }>;

export function bunnyStorageHost(region: BunnyRegion): string {
  return region === 'de' ? 'storage.bunnycdn.com' : `${region}.storage.bunnycdn.com`;
}

interface BunnyEntry {
  readonly name: string;
  readonly directory: boolean;
  readonly sizeBytes: number | undefined;
  readonly modified: string | undefined;
}

export function bunnyStore(connection: Pick<BunnyConnection, 'storageZone' | 'region' | 'publicBaseUrl'>, accessKey: string, fetcher: MediaFetch): MediaStore {
  assert(accessKey.length > 0, 'Bunny Storage needs its password');
  const base = `https://${bunnyStorageHost(connection.region)}/${encodeURIComponent(connection.storageZone)}`;
  const address = (path: string): string => `${base}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const folderAddress = (folder: string): string => (folder === '' ? `${base}/` : `${address(folder)}/`);
  const request = (method: MediaRequest['method'], url: string, extra: Readonly<Record<string, string>>, body?: Uint8Array): Promise<Response> =>
    send(fetcher, {
      method,
      url,
      headers: { AccessKey: accessKey, ...extra },
      body,
      timeoutMs: body === undefined ? MEDIA_HTTP_LIMITS.requestTimeoutMs : MEDIA_HTTP_LIMITS.transferTimeoutMs,
    });
  const entries = async (folder: string): Promise<readonly BunnyEntry[]> => {
    const response = await request('GET', folderAddress(folder), { accept: 'application/json' });
    await expectOk(response, describeFailure);
    const parsed: unknown = JSON.parse(await readText(response));
    return parseBunnyListing(parsed);
  };
  return {
    host: 'Bunny Storage',
    async list(folder) {
      const listed = await entries(folder);
      const bound = MEDIA_HOSTING_LIMITS.entriesPerFolderMax;
      const shown = listed.filter((entry) => nameable(entry.name));
      const folders = shown.filter((entry) => entry.directory).map((entry) => entry.name);
      const files: StoredFile[] = shown
        .filter((entry) => !entry.directory)
        .map((entry) => ({ name: entry.name, sizeBytes: entry.sizeBytes, modified: entry.modified }));
      return { folders: folders.slice(0, bound), files: files.slice(0, bound), truncated: folders.length > bound || files.length > bound };
    },
    async keysUnder(folder, keysMax) {
      assert(folder !== '', 'A tree is below a folder, never the whole zone');
      const keys: string[] = [];
      const queue: string[] = [''];
      for (let visited = 0; visited < queue.length; visited++) {
        const relative = queue[visited] ?? '';
        if (relative.split('/').length > MEDIA_HOSTING_LIMITS.folderDepthMax) {
          throw new MediaHostError(described('cmsBackend.media.nestedTooDeep'), 0);
        }
        for (const entry of await entries(relative === '' ? folder : `${folder}/${relative}`)) {
          const key = relative === '' ? entry.name : `${relative}/${entry.name}`;
          keys.push(entry.directory ? `${key}/` : key);
          if (entry.directory) {
            queue.push(key);
          }
          if (keys.length > keysMax) {
            throw new MediaHostError(described('cmsBackend.media.tooManyFilesBunny', { count: keysMax }), 0);
          }
        }
      }
      return keys;
    },
    async read(key, bytesMax) {
      const response = await request('GET', address(key), {});
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      await expectOk(response, describeFailure);
      return readBounded(response, bytesMax);
    },
    async write(key, bytes, contentType) {
      assert(bytes.length <= MEDIA_HTTP_LIMITS.fileBytesMax, 'An upload is bounded');
      const response = await request('PUT', address(key), { 'content-type': contentType, Checksum: sha256Hex(bytes).toUpperCase() }, bytes);
      await expectOk(response, describeFailure);
      await response.body?.cancel();
    },
    async copy(fromKey, toKey) {
      assert(fromKey !== toKey, 'A copy goes somewhere else');
      const bytes = await this.read(fromKey, MEDIA_HTTP_LIMITS.fileBytesMax);
      if (bytes === undefined) {
        throw new MediaHostError(described('cmsBackend.media.fileGone'), 404);
      }
      await this.write(toKey, bytes, contentTypeOf(toKey));
    },
    async remove(key) {
      const response = await request('DELETE', address(key), {});
      if (response.status !== 404) {
        await expectOk(response, describeFailure);
      }
      await response.body?.cancel();
    },
    async createFolder(folder) {
      assert(folder !== '', 'The root is not created');
      const response = await request('PUT', folderAddress(folder), { 'content-type': 'application/octet-stream' }, new Uint8Array(0));
      await expectOk(response, describeFailure);
      await response.body?.cancel();
    },
    async removeFolder(folder) {
      assert(folder !== '', 'The root is never removed');
      const response = await request('DELETE', folderAddress(folder), {});
      if (response.status !== 404) {
        await expectOk(response, describeFailure);
      }
      await response.body?.cancel();
    },
    publicURL: (key) => publicURLOf(connection.publicBaseUrl, key),
  };
}

function describeFailure(status: number, body: string): Described {
  let detail = '';
  try {
    const parsed: unknown = JSON.parse(body);
    const message: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'Message') : undefined;
    detail = typeof message === 'string' ? ` Bunny said: ${message}` : '';
  } catch {
  }
  return statusProblem(status, detail);
}

export function parseBunnyListing(input: unknown): readonly BunnyEntry[] {
  if (!Array.isArray(input)) {
    throw new MediaHostError(described('cmsBackend.media.bunnyNotList'), 0);
  }
  const bounded: readonly unknown[] = input.slice(0, 2 * MEDIA_HOSTING_LIMITS.entriesPerFolderMax + 1);
  return bounded.map(parseBunnyEntry);
}

function nameable(name: string): boolean {
  try {
    parseMediaName(name);
    return true;
  } catch {
    return false;
  }
}

function parseBunnyEntry(input: unknown): BunnyEntry {
  if (typeof input !== 'object' || input === null) {
    throw new MediaHostError(described('cmsBackend.media.bunnyUnreadable'), 0);
  }
  const name: unknown = Reflect.get(input, 'ObjectName');
  const directory: unknown = Reflect.get(input, 'IsDirectory');
  if (typeof name !== 'string' || typeof directory !== 'boolean') {
    throw new MediaHostError(described('cmsBackend.media.bunnyUnreadable'), 0);
  }
  if (name === '' || name.includes('/')) {
    throw new MediaHostError(described('cmsBackend.media.bunnyUnreadable'), 0);
  }
  const length: unknown = Reflect.get(input, 'Length');
  const changed: unknown = Reflect.get(input, 'LastChanged');
  return {
    name,
    directory,
    sizeBytes: typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 && !directory ? length : undefined,
    modified: typeof changed === 'string' ? bunnyTime(changed) : undefined,
  };
}

function bunnyTime(value: string): string | undefined {
  const zoned = /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(zoned);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
