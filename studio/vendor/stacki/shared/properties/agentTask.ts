import { assert } from '../core/assert';
import type { BuiltinChipId } from './ai/mentions';

export const AGENT_TASK_LIMITS = {
  titleCharsMax: 200,
  promptCharsMax: 60_000,
  filesMax: 200,
  nodeRefsMax: 500,
  findingIdsMax: 1_000,
} as const satisfies Record<string, number>;

export interface AgentNodeRef {
  readonly file: string;
  readonly path: readonly number[];
}

export type AgentTaskDelivery = 'send' | 'draft';

export interface AgentTask {
  readonly title: string;
  readonly prompt: string;
  readonly delivery?: AgentTaskDelivery;
  readonly draftChip?: BuiltinChipId;
  readonly surface?: 'auditFix' | 'appBuild';
  readonly context: {
    readonly files: readonly string[];
    readonly nodeRefs: readonly AgentNodeRef[];
    readonly findingIds: readonly string[];
  };
}

export function agentTask(input: AgentTask): AgentTask {
  assert(input.title.trim().length > 0, 'agentTask: a task has a title');
  assert(input.title.length <= AGENT_TASK_LIMITS.titleCharsMax, 'agentTask: the title is bounded');
  assert(input.prompt.trim().length > 0, 'agentTask: a task has a prompt');
  assert(input.prompt.length <= AGENT_TASK_LIMITS.promptCharsMax, 'agentTask: the prompt is bounded');
  assert(input.draftChip === undefined || input.delivery === 'draft', 'agentTask: a draft chip belongs to a draft');
  assert(input.context.files.length <= AGENT_TASK_LIMITS.filesMax, 'agentTask: the files are bounded');
  assert(input.context.nodeRefs.length <= AGENT_TASK_LIMITS.nodeRefsMax, 'agentTask: the element references are bounded');
  assert(input.context.findingIds.length <= AGENT_TASK_LIMITS.findingIdsMax, 'agentTask: the finding ids are bounded');
  assert(
    input.context.files.every((file) => file.length > 0 && !file.startsWith('/')),
    'agentTask: files are project-relative',
  );
  return input;
}
