
declare const brand: unique symbol;
export type Brand<T, B> = T & { readonly [brand]: B };

export type NodeId = Brand<string, 'NodeId'>;

export type FilePath = Brand<string, 'FilePath'>;

export type ProjectPath = Brand<string, 'ProjectPath'>;

export type Digest = Brand<string, 'Digest'>;

const NODE_ID_RE = /^(?:n\d+(?:\.\d+)*|m\d+|layout|s[0-9a-f]{16}\.\d+(?:\.\d+)*(?:~\d+)?|g[0-9a-f]{32})$/;

export function toNodeId(value: string): NodeId {
  if (!NODE_ID_RE.test(value)) {
    throw new Error(`NodeId: expected 'n<path>', 'm<N>', 'layout', 's<snapshot>.<path>' or 'g<gesture>', ` + `got ${JSON.stringify(value)}`);
  }
  return value as NodeId;
}

const DIGEST_RE = /^[0-9a-f]{64}$/;

export function toDigest(value: string): Digest {
  if (!DIGEST_RE.test(value)) {
    throw new Error('Digest: expected 64 lowercase hex characters');
  }
  return value as Digest;
}

export function toFilePath(value: string): FilePath {
  if (value.length === 0) {
    throw new Error('FilePath: expected non-empty string');
  }
  return value as FilePath;
}

export function toProjectPath(value: string): ProjectPath {
  if (value.length === 0) {
    throw new Error('ProjectPath: expected non-empty string');
  }
  return value as ProjectPath;
}

export type ByteOffset = Brand<number, 'ByteOffset'>;

export type Utf16Offset = Brand<number, 'Utf16Offset'>;

export type IntentId = Brand<string, 'IntentId'>;

const INTENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function toByteOffset(value: number): ByteOffset {
  if (!Number.isSafeInteger(value)) {
    throw new Error('ByteOffset: expected safe integer');
  }
  if (value < 0) {
    throw new Error('ByteOffset: expected nonnegative integer');
  }
  return value as ByteOffset;
}

export function toUtf16Offset(value: number): Utf16Offset {
  if (!Number.isSafeInteger(value)) {
    throw new Error('Utf16Offset: expected safe integer');
  }
  if (value < 0) {
    throw new Error('Utf16Offset: expected nonnegative integer');
  }
  return value as Utf16Offset;
}

export function toIntentId(value: string): IntentId {
  if (!INTENT_ID_RE.test(value)) {
    throw new Error('IntentId: expected 1 to 64 characters from [A-Za-z0-9_-]');
  }
  return value as IntentId;
}
