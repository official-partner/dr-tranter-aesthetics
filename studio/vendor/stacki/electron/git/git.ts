
import { toRecord } from '../../shared/core/record';

export interface GitResult {
  readonly stdout: string;
  readonly stderr?: string;
}

export interface GitRunOptions {
  readonly timeout?: number;
}

export type Git = (projectPath: string, args: readonly string[], options?: GitRunOptions) => Promise<GitResult>;

const stderrOf = (error: unknown): string | undefined => {
  const stderr = toRecord(error)?.['stderr'];
  return typeof stderr === 'string' ? stderr : undefined;
};

export function gitErrorDetail(error: unknown): string {
  return stderrOf(error) || (error instanceof Error ? error.message : '');
}

export function gitErrorFull(error: unknown): string {
  const stdout = toRecord(error)?.['stdout'];
  return `${typeof stdout === 'string' ? stdout : ''}\n${gitErrorDetail(error)}`;
}
