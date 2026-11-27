import { list, object, pathText } from '../core/boundary';
import { assert } from '../core/assert';
import { AGENT_IDS, parseAgentId, type AgentId } from '../properties/ai/agentIds';
import { parseAgentDeleteTarget, parseAgentFields, type AgentListing, type AgentWriteResult } from '../properties/projectAgents';

const projectPath = pathText;

function parseSaveMode(input: unknown): 'create' | 'update' {
  if (input === 'create' || input === 'update') {
    return input;
  }
  throw new Error('agents:save mode: expected create or update');
}

function parseOverwrite(input: unknown): readonly AgentId[] {
  const providers = list(parseAgentId)(input);
  if (new Set(providers).size !== providers.length) {
    throw new Error('agents:save overwrite: a provider is named twice');
  }
  assert(providers.length <= AGENT_IDS.length, 'parseOverwrite: at most every provider');
  return providers;
}

export const AGENT_PAYLOADS = {
  'agents:list': object({ projectPath }),
  'agents:save': object({ projectPath, fields: parseAgentFields, mode: parseSaveMode, overwrite: parseOverwrite }),
  'agents:delete': object({ projectPath, target: parseAgentDeleteTarget }),
} as const;

export interface AgentResults {
  readonly 'agents:list': AgentListing;
  readonly 'agents:save': AgentWriteResult;
  readonly 'agents:delete': AgentWriteResult;
}
