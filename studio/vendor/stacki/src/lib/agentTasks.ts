import { assert } from '../../shared/core/assert';
import { agentTask, type AgentTask } from '../../shared/properties/agentTask';
import type { Translator } from '../../shared/properties/i18n/messageRef';

export type AgentTaskOutcome =
  | { readonly tag: 'sent'; readonly where: string }
  | { readonly tag: 'copied' }
  | { readonly tag: 'failed'; readonly message: string };

export type AgentTaskHandler = (task: AgentTask) => Promise<{ readonly tag: 'sent'; readonly where: string } | { readonly tag: 'declined' }>;

interface Registration {
  readonly name: string;
  readonly priority: number;
  readonly handle: AgentTaskHandler;
}

const HANDLERS_MAX = 16;
const handlers: Registration[] = [];

export function registerAgentTaskHandler(name: string, priority: number, handle: AgentTaskHandler): () => void {
  assert(name.length > 0, 'registerAgentTaskHandler: a handler has a name');
  assert(Number.isFinite(priority), 'registerAgentTaskHandler: a priority is a number');
  const existing = handlers.findIndex((entry) => entry.name === name);
  if (existing !== -1) {
    handlers.splice(existing, 1);
  }
  assert(handlers.length < HANDLERS_MAX, 'registerAgentTaskHandler: handlers are bounded');
  const registration: Registration = { name, priority, handle };
  handlers.push(registration);
  handlers.sort((left, right) => right.priority - left.priority);
  return () => {
    const index = handlers.indexOf(registration);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  };
}

export function agentTaskHandlerNames(): readonly string[] {
  return handlers.map((entry) => entry.name);
}

export async function requestAgentTask(task: AgentTask): Promise<AgentTaskOutcome> {
  const checked = agentTask(task);
  for (const registration of [...handlers]) {
    let answer: Awaited<ReturnType<AgentTaskHandler>>;
    try {
      answer = await registration.handle(checked);
    } catch {
      continue;
    }
    if (answer.tag === 'sent') {
      return answer;
    }
  }
  return copyPrompt(checked.prompt);
}

async function copyPrompt(prompt: string): Promise<AgentTaskOutcome> {
  try {
    await navigator.clipboard.writeText(prompt);
    return { tag: 'copied' };
  } catch (error: unknown) {
    return { tag: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

export function agentTaskMessage(outcome: AgentTaskOutcome, translate: Translator): { readonly message: string; readonly kind: 'success' | 'info' | 'error' } {
  switch (outcome.tag) {
    case 'sent':
      return { message: translate('ui.handoff.sent', { where: outcome.where }), kind: 'success' };
    case 'copied':
      return { message: translate('ui.handoff.copied'), kind: 'info' };
    case 'failed':
      return { message: translate('ui.handoff.failed', { reason: outcome.message }), kind: 'error' };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
