import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { parseMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { toArray } from '../core/record';
import { described, englishText, messageRef, type MessageKey, type TypedMessageRef } from './i18n/messageRef';

export const APP_SECRET_LIMITS = {
  filesMax: 200,
  fileBytesMax: 5 * 1024 * 1024,
  bytesMax: 20 * 1024 * 1024,
  findingsMax: 50,
  allowlistMax: 32,
  excerptContextChars: 24,
} as const satisfies Record<string, number>;

export const APP_SECRET_PATTERNS: readonly { readonly rule: AppSecretRule; readonly pattern: RegExp }[] = [
  { rule: 'sk-key', pattern: /\bsk-(?:[a-z]+-)?[A-Za-z0-9]{20,}/g },
  { rule: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { rule: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { rule: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { rule: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { rule: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { rule: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9_/-]{20,}/g },
  { rule: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { rule: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    rule: 'assigned-secret',
    pattern:
      /(?<![A-Za-z0-9_$.-])[A-Za-z0-9_$.-]{0,64}(?:key|token|secret|password|passwd|auth)[A-Za-z0-9_$]{0,64}["']?\s*[:=]\s*["'`](?:[A-Za-z0-9+/_-]{32,}={0,2}|[0-9a-fA-F]{32,})["'`]/gi,
  },
];

export type AppSecretRule =
  | 'sk-key'
  | 'stripe-key'
  | 'github-token'
  | 'github-pat'
  | 'aws-access-key'
  | 'google-api-key'
  | 'slack-token'
  | 'slack-webhook'
  | 'private-key'
  | 'jwt'
  | 'assigned-secret';

const RULES: readonly AppSecretRule[] = APP_SECRET_PATTERNS.map((entry) => entry.rule);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'js', 'mjs', 'css', 'json', 'map', 'txt', 'md', 'svg', 'gltf']);

export interface AppSecretFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: AppSecretRule;
  readonly excerpt: string;
  readonly lineSha256: string;
}

export interface AppSecretAllowance {
  readonly file: string;
  readonly lineSha256: string;
}

export type AppSecretScan =
  | { readonly kind: 'clean'; readonly filesScanned: number }
  | { readonly kind: 'found'; readonly findings: readonly AppSecretFinding[]; readonly truncated: boolean; readonly filesScanned: number }
  | { readonly kind: 'too-large'; readonly reason: string; readonly reasonRef?: MessageRef | undefined };

export interface ScannedFile {
  readonly path: string;
  readonly text: string;
}

export interface AppSecretScanOptions {
  readonly allowlist: readonly AppSecretAllowance[];
  readonly placeholders: readonly string[];
  readonly lineSha256: (line: string) => string;
}

export function isScannedFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && TEXT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

export function scanAppSecrets(files: readonly ScannedFile[], options: AppSecretScanOptions): AppSecretScan {
  if (files.length > APP_SECRET_LIMITS.filesMax) {
    return tooLarge('apps.scan.tooManyFiles', { max: APP_SECRET_LIMITS.filesMax });
  }
  if (options.allowlist.length > APP_SECRET_LIMITS.allowlistMax) {
    return tooLarge('apps.scan.allowlistTooLong', { max: APP_SECRET_LIMITS.allowlistMax });
  }
  const allowed = new Set(options.allowlist.map((entry) => `${entry.file}\n${entry.lineSha256}`));
  const placeholders = options.placeholders.filter((placeholder) => placeholder.length > 0);
  let totalChars = 0;
  for (const file of files) {
    if (file.text.length > APP_SECRET_LIMITS.fileBytesMax) {
      return tooLarge('apps.scan.fileTooLarge', { path: file.path, max: APP_SECRET_LIMITS.fileBytesMax });
    }
    totalChars += file.text.length;
  }
  if (totalChars > APP_SECRET_LIMITS.bytesMax) {
    return tooLarge('apps.scan.tooManyBytes', { max: APP_SECRET_LIMITS.bytesMax });
  }
  const findings: AppSecretFinding[] = [];
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const matches = matchSecretLine(line).filter((match) => !isPlaceholder(line.slice(match.start, match.end), placeholders));
      if (matches.length === 0) {
        continue;
      }
      const lineSha256 = options.lineSha256(line);
      assert(/^[0-9a-f]{64}$/.test(lineSha256), 'A line hash is a lowercase hex SHA-256');
      if (allowed.has(`${file.path}\n${lineSha256}`)) {
        continue;
      }
      for (const match of matches) {
        if (findings.length >= APP_SECRET_LIMITS.findingsMax) {
          return { kind: 'found', findings, truncated: true, filesScanned: files.length };
        }
        findings.push({ file: file.path, line: index + 1, rule: match.rule, excerpt: maskedExcerpt(line, matches, match), lineSha256 });
      }
    }
  }
  assert(findings.length <= APP_SECRET_LIMITS.findingsMax, 'Findings are bounded');
  if (findings.length === 0) {
    return { kind: 'clean', filesScanned: files.length };
  }
  return { kind: 'found', findings, truncated: false, filesScanned: files.length };
}

function isPlaceholder(matched: string, placeholders: readonly string[]): boolean {
  return placeholders.some((placeholder) => placeholder.includes(matched) || matched.includes(placeholder));
}

export interface SecretLineMatch {
  readonly rule: AppSecretRule;
  readonly start: number;
  readonly end: number;
}

export function matchSecretLine(line: string): readonly SecretLineMatch[] {
  const matches: SecretLineMatch[] = [];
  for (const { rule, pattern } of APP_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (let found = pattern.exec(line); found !== null; found = pattern.exec(line)) {
      const start = found.index;
      const end = start + found[0].length;
      assert(end > start, 'A secret match is never empty');
      if (!matches.some((other) => start < other.end && other.start < end)) {
        matches.push({ rule, start, end });
      }
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

export function maskedExcerpt(line: string, matches: readonly SecretLineMatch[], target: SecretLineMatch): string {
  assert(matches.includes(target), 'An excerpt is for one of the line’s matches');
  let masked = '';
  let cursor = 0;
  for (const match of matches) {
    masked += line.slice(cursor, match.start);
    masked += line.slice(match.start, Math.min(match.start + 4, match.end));
    masked += '*'.repeat(Math.max(0, match.end - match.start - 4));
    cursor = match.end;
  }
  masked += line.slice(cursor);
  const context = APP_SECRET_LIMITS.excerptContextChars;
  const from = Math.max(0, target.start - context);
  const to = Math.min(masked.length, target.end + context);
  const window = masked.slice(from, to).replace(/\*{13,}/g, '*'.repeat(12));
  const excerpt = `${from > 0 ? '…' : ''}${window}${to < masked.length ? '…' : ''}`;
  assert(!excerpt.includes(line.slice(target.start, target.end)) || target.end - target.start <= 4, 'An excerpt never shows a whole match');
  return excerpt;
}

export function parseSecretsAllowlist(input: unknown, parsePath: (path: unknown) => string): readonly AppSecretAllowance[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('secretsAllowlist is a list');
  }
  if (items.length > APP_SECRET_LIMITS.allowlistMax) {
    throw new Error(`secretsAllowlist has at most ${APP_SECRET_LIMITS.allowlistMax} entries`);
  }
  return items.map((item) => {
    const entry = record(item);
    const hash = entry['lineSha256'];
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error('A secretsAllowlist entry’s lineSha256 is a lowercase hex SHA-256');
    }
    return { file: parsePath(entry['file']), lineSha256: hash };
  });
}

function tooLarge(key: MessageKey, params: Readonly<Record<string, string | number>>): Extract<AppSecretScan, { readonly kind: 'too-large' }> {
  const reason = described(key, params);
  return { kind: 'too-large', reason: reason.message, reasonRef: reason.messageRef };
}

export function parseAppSecretScan(input: unknown): AppSecretScan {
  const value = record(input);
  switch (value['kind']) {
    case 'clean':
      return { kind: 'clean', filesScanned: scannedCount(value['filesScanned']) };
    case 'too-large':
      return { kind: 'too-large', reason: boundedReason(value['reason']), ...optionalReasonRef(value['reasonRef']) };
    case 'found': {
      const items = toArray(value['findings']);
      if (items === undefined || items.length === 0 || items.length > APP_SECRET_LIMITS.findingsMax) {
        throw new Error('A scan that found something lists 1 to 50 findings');
      }
      if (typeof value['truncated'] !== 'boolean') {
        throw new Error('A scan says whether it stopped early');
      }
      return { kind: 'found', findings: items.map(parseFinding), truncated: value['truncated'], filesScanned: scannedCount(value['filesScanned']) };
    }
    default:
      throw new Error('A secret scan is clean, found or too-large');
  }
}

function parseFinding(input: unknown): AppSecretFinding {
  const value = record(input);
  const line = value['line'];
  if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1) {
    throw new Error('A finding names a line');
  }
  const rule = RULES.find((known) => known === value['rule']);
  if (rule === undefined) {
    throw new Error('A finding names a known rule');
  }
  const hash = text(value['lineSha256']);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('A finding carries its line’s SHA-256');
  }
  const file = text(value['file']);
  if (file.length === 0 || file.length > 200) {
    throw new Error('A finding names its file');
  }
  const excerpt = text(value['excerpt']);
  if (excerpt.length > 400) {
    throw new Error('A finding’s excerpt is bounded');
  }
  return { file, line, rule, excerpt, lineSha256: hash };
}

function scannedCount(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > APP_SECRET_LIMITS.filesMax) {
    throw new Error('A scan counts the files it read');
  }
  return input;
}

function optionalReasonRef(input: unknown): { readonly reasonRef?: MessageRef } {
  if (input === undefined) {
    return {};
  }
  const parsed = parseMessageRef(input);
  return parsed.ok ? { reasonRef: parsed.value } : {};
}

function boundedReason(input: unknown): string {
  const reason = text(input).trim();
  if (reason.length === 0 || reason.length > 500) {
    throw new Error('A refused scan says why');
  }
  return reason;
}

export function secretRuleRef(rule: AppSecretRule): TypedMessageRef {
  switch (rule) {
    case 'sk-key':
      return messageRef('apps.scan.rule.skKey');
    case 'stripe-key':
      return messageRef('apps.scan.rule.stripeKey');
    case 'github-token':
      return messageRef('apps.scan.rule.githubToken');
    case 'github-pat':
      return messageRef('apps.scan.rule.githubPat');
    case 'aws-access-key':
      return messageRef('apps.scan.rule.awsAccessKey');
    case 'google-api-key':
      return messageRef('apps.scan.rule.googleApiKey');
    case 'slack-token':
      return messageRef('apps.scan.rule.slackToken');
    case 'slack-webhook':
      return messageRef('apps.scan.rule.slackWebhook');
    case 'private-key':
      return messageRef('apps.scan.rule.privateKey');
    case 'jwt':
      return messageRef('apps.scan.rule.jwt');
    case 'assigned-secret':
      return messageRef('apps.scan.rule.assignedSecret');
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

export function secretRuleLabel(rule: AppSecretRule): string {
  return englishText(secretRuleRef(rule));
}
