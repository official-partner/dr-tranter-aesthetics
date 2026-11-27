import { assert } from '../core/assert';
import type { Digest, FilePath } from '../core/brand';
import { LIMITS } from '../core/limits';
import type { Projection } from './sourceProjection';
import type { ByteString } from '../core/span';

export interface Snapshot {
  readonly path: FilePath;
  readonly checksum: Digest;
  readonly bytes: ByteString;
  readonly projection: Projection;
}

export function createSnapshot(input: Pick<Snapshot, 'path' | 'bytes' | 'projection'>, hash: (bytes: ByteString) => Digest): Snapshot {
  assert(input.bytes.length <= LIMITS.sourceBytesMax, 'Snapshot bytes are inside the file bound');
  assert(input.projection.byteLength === input.bytes.length, 'The projection was derived from bytes of this length');
  return {
    path: input.path,
    checksum: hash(input.bytes),
    bytes: input.bytes,
    projection: input.projection,
  };
}

export function createLazySnapshot(
  input: Pick<Snapshot, 'path' | 'bytes'>,
  project: (bytes: ByteString) => Projection,
  hash: (bytes: ByteString) => Digest,
): Snapshot {
  assert(input.bytes.length <= LIMITS.sourceBytesMax, 'Snapshot bytes are inside the file bound');
  let derived: Projection | undefined;
  return {
    path: input.path,
    checksum: hash(input.bytes),
    bytes: input.bytes,
    get projection(): Projection {
      if (derived === undefined) {
        const projection = project(input.bytes);
        assert(projection.byteLength === input.bytes.length, 'The projection was derived from bytes of this length');
        derived = projection;
      }
      return derived;
    },
  };
}
