import { assert } from '../core/assert';
import { list, optional, pathText, record, text } from '../core/boundary';
import { parseGitHubLogin, parseGitHubLoginQuery } from '../properties/projectRoles';
import { parseAvatarURL } from './commitAvatars';

export const GITHUB_USER_SEARCH_LIMITS = {
  usersMax: 8,
  nameCharsMax: 255,
  debounceMs: 250,
} as const satisfies Record<string, number>;

export const GITHUB_USER_SOURCES = ['collaborator', 'author', 'search'] as const;
export type GitHubUserSource = (typeof GITHUB_USER_SOURCES)[number];

export const GITHUB_SEARCH_STATES = ['searched', 'unavailable'] as const;
export type GitHubSearchState = (typeof GITHUB_SEARCH_STATES)[number];

export interface GitHubUserSuggestion {
  readonly login: string;
  readonly name: string | undefined;
  readonly avatarURL: string | undefined;
  readonly source: GitHubUserSource;
}

export interface GitHubUserSearchRequest {
  readonly projectPath: string;
  readonly query: string;
}

export interface GitHubUserSearchResult {
  readonly users: readonly GitHubUserSuggestion[];
  readonly github: GitHubSearchState;
}

export function githubUserQuery(typed: string): string | undefined {
  try {
    return parseGitHubLoginQuery(typed);
  } catch {
    return undefined;
  }
}

export function parseGitHubUserSearchRequest(input: unknown): GitHubUserSearchRequest {
  const value = record(input);
  const projectPath = pathText(value['projectPath']);
  assert(projectPath.length > 0, 'GitHub user search: project path is required');
  return { projectPath, query: parseGitHubLoginQuery(value['query']) };
}

export function parseGitHubUserSearchResult(input: unknown): GitHubUserSearchResult {
  const value = record(input);
  const users = list(parseGitHubUserSuggestion)(value['users']);
  if (users.length > GITHUB_USER_SEARCH_LIMITS.usersMax) {
    throw new Error('GitHub user search: reply exceeds limit');
  }
  const logins = new Set(users.map((user) => user.login.toLowerCase()));
  if (logins.size !== users.length) {
    throw new Error('GitHub user search: duplicate login');
  }
  const github = GITHUB_SEARCH_STATES.find((state) => state === value['github']);
  if (github === undefined) {
    throw new Error('GitHub user search: unknown search state');
  }
  return { users, github };
}

export function parseGitHubUserSuggestion(input: unknown): GitHubUserSuggestion {
  const value = record(input);
  const source = GITHUB_USER_SOURCES.find((item) => item === value['source']);
  if (source === undefined) {
    throw new Error('GitHub user search: unknown source');
  }
  return {
    login: parseGitHubLogin(value['login']),
    name: optional(parseGitHubName)(value['name']),
    avatarURL: optional(parseAvatarURL)(value['avatarURL']),
    source,
  };
}

export function parseGitHubName(input: unknown): string | undefined {
  const name = text(input).trim();
  if (name.length > GITHUB_USER_SEARCH_LIMITS.nameCharsMax) {
    throw new Error('GitHub user search: name exceeds limit');
  }
  return name.length === 0 ? undefined : name;
}
