import { boolean, count, object, optional, record, text } from '../core/boundary';
import { assert } from '../core/assert';
import { parseReviewReceipt, type ReviewReceipt } from './publishReview';
import type { PublishTarget } from './publishConfig';
import { parseMessageRef, type MessageRef } from '../core/i18n/messageReference';

export type PublishDestinationState = 'current' | 'pending' | 'unknown' | 'unconfigured';

export interface PublishAvailability {
  readonly github: Exclude<PublishDestinationState, 'unconfigured'>;
  readonly hosting: PublishDestinationState;
  readonly githubPush?: GitHubPush;
}

export interface GitHubPush {
  readonly commits: number;
  readonly repositoryUrl: string;
}

export const UNKNOWN_PUBLISH_AVAILABILITY: PublishAvailability = {
  github: 'unknown',
  hosting: 'unknown',
};

export type PublishButtonState = 'ready' | 'current' | 'unconfirmed';

type DestinationNeed = 'done' | 'needed' | 'unconfirmed';

export function publishButtonState(availability: PublishAvailability, target: PublishTarget): PublishButtonState {
  switch (target) {
    case 'github':
      return buttonStateOf([githubNeed(availability.github)]);
    case 'hosting':
      return buttonStateOf([hostingTargetNeed(availability.hosting)]);
    case 'all':
      return buttonStateOf([githubNeed(availability.github), hostingNeed(availability.hosting)]);
  }
}

function buttonStateOf(needs: readonly DestinationNeed[]): PublishButtonState {
  if (needs.includes('needed')) {
    return 'ready';
  }
  if (needs.includes('unconfirmed')) {
    return 'unconfirmed';
  }
  return 'current';
}

function githubNeed(state: PublishAvailability['github']): DestinationNeed {
  switch (state) {
    case 'current':
      return 'done';
    case 'pending':
      return 'needed';
    case 'unknown':
      return 'unconfirmed';
  }
}

function hostingNeed(state: PublishDestinationState): DestinationNeed {
  switch (state) {
    case 'current':
    case 'unconfigured':
      return 'done';
    case 'pending':
      return 'needed';
    case 'unknown':
      return 'unconfirmed';
  }
}

function hostingTargetNeed(state: PublishDestinationState): DestinationNeed {
  return state === 'unconfigured' ? 'needed' : hostingNeed(state);
}

export function parsePublishAvailability(input: unknown): PublishAvailability {
  const value = object({
    github: parseDestinationState,
    hosting: parseDestinationState,
    githubPush: optional(parseGitHubPush),
  })(input);
  assert(value.github !== 'unconfigured', 'GitHub is always a publishing destination');
  if (value.github === 'current') {
    if (value.githubPush !== undefined) {
      assert(value.githubPush.commits === 0, 'Current GitHub status cannot have commits to push');
    }
  }
  return { ...value, github: value.github };
}

export function parseGitHubPush(input: unknown): GitHubPush {
  const value = object({ commits: count, repositoryUrl: text })(input);
  assert(value.commits <= 1_000_000, 'GitHub push commit count exceeds limit');
  assert(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(value.repositoryUrl), 'GitHub repository link must be a repository on github.com');
  return value;
}

function parseDestinationState(input: unknown): PublishDestinationState {
  assert(typeof input === 'string', 'Publish destination state must be a string');
  switch (input) {
    case 'current':
    case 'pending':
    case 'unknown':
    case 'unconfigured':
      return input;
    default:
      throw new Error('Invalid publish destination state.');
  }
}

export type DesktopPublishState =
  | ({ readonly kind: 'review-open' } & ReviewReceipt)
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      readonly step: string;
      readonly stepRef?: MessageRef | undefined;
      readonly progress?: DesktopPublishProgress;
    }
  | {
      readonly kind: 'done';
      readonly github: boolean;
      readonly hosting: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly messageRef?: MessageRef | undefined;
      readonly github: boolean;
      readonly hosting: boolean;
    };

export interface DesktopPublishProgress {
  readonly completed: number;
  readonly total: number;
}

export function parseDesktopPublishProgress(input: unknown): DesktopPublishProgress {
  const value = object({ completed: count, total: count })(input);
  assert(value.total >= 3, 'Publish progress must have at least 3 stages');
  assert(value.total <= 5, 'Publish progress cannot exceed 5 stages');
  assert(value.completed < value.total, 'Running publish progress must be incomplete');
  return value;
}

export function parseDesktopPublishState(input: unknown): DesktopPublishState {
  const value = record(input);
  switch (value['kind']) {
    case 'review-open':
      return { kind: 'review-open', ...parseReviewReceipt(value) };
    case 'idle':
      return { kind: 'idle' };
    case 'running':
      return {
        kind: 'running',
        ...object({ step: text, progress: optional(parseDesktopPublishProgress) })(value),
        ...stepRefField(optionalRef(value, 'stepRef')),
      };
    case 'done':
      return { kind: 'done', ...object({ github: boolean, hosting: boolean })(value) };
    case 'failed':
      return {
        kind: 'failed',
        ...object({ message: text, github: boolean, hosting: boolean })(value),
        ...messageRefField(optionalRef(value, 'messageRef')),
      };
    default:
      throw new Error('Invalid publish status.');
  }
}

function optionalRef(value: Readonly<Record<string, unknown>>, name: string): MessageRef | undefined {
  const field = value[name];
  if (field === undefined) {
    return undefined;
  }
  const parsed = parseMessageRef(field);
  return parsed.ok ? parsed.value : undefined;
}

function stepRefField(stepRef: MessageRef | undefined): { readonly stepRef?: MessageRef } {
  return stepRef === undefined ? {} : { stepRef };
}
function messageRefField(messageRef: MessageRef | undefined): { readonly messageRef?: MessageRef } {
  return messageRef === undefined ? {} : { messageRef };
}
