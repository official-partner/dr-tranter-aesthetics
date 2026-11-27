import { assert } from '../../../shared/core/assert';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { agentTask } from '../../../shared/properties/agentTask';
import { requestAgentTask } from '../../lib/agentTasks';
import { provideBuiltinInstructions } from '../../lib/builtinInstructions';
import { APPS_PROMPT } from './generated/appsPrompt';

export function appBuildPrompt(): string {
  assert(APPS_PROMPT.length > 0, 'The prompt is never empty');
  return APPS_PROMPT;
}

provideBuiltinInstructions('app-builder', appBuildPrompt);

export async function requestBuildApp(translate: Translator, notify: (message: string, kind: 'success' | 'error') => void): Promise<void> {
  const outcome = await requestAgentTask(
    agentTask({
      title: translate('apps.build.label'),
      prompt: appBuildPrompt(),
      delivery: 'draft',
      draftChip: 'app-builder',
      surface: 'appBuild',
      context: { files: [], nodeRefs: [], findingIds: [] },
    }),
  );
  switch (outcome.tag) {
    case 'sent':
      return;
    case 'copied':
      notify(translate('apps.build.copied', { action: translate('apps.build.label') }), 'success');
      return;
    case 'failed':
      notify(translate('apps.build.failed', { message: outcome.message }), 'error');
      return;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
