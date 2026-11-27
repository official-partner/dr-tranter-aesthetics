import { err, ok, type Result } from '../core/result';
import type { PublishConfig } from './publishConfig';

export type MissingPublishField = 'cloudflareAccount' | 'hostingProject' | 'vercelOrganization' | 'buildScript';
export interface MissingPublishError {
  readonly field: MissingPublishField;
}

export function findMissingPublishField(config: Pick<PublishConfig, 'hosting' | 'buildScript'>): Result<undefined, MissingPublishError> {
  const { hosting } = config;
  switch (hosting.provider) {
    case 'none':
      break;
    case 'cloudflare':
    case 'cloudflare-workers':
      if (hosting.accountId.trim() === '') {
        return err({ field: 'cloudflareAccount' });
      }
      if (hosting.project.trim() === '') {
        return err({ field: 'hostingProject' });
      }
      break;
    case 'vercel':
      if (hosting.projectId.trim() === '') {
        return err({ field: 'hostingProject' });
      }
      if (hosting.organizationId.trim() === '') {
        return err({ field: 'vercelOrganization' });
      }
      break;
    case 'netlify':
      if (hosting.siteId.trim() === '') {
        return err({ field: 'hostingProject' });
      }
      break;
    default: {
      const exhaustive: never = hosting;
      return exhaustive;
    }
  }
  if (config.buildScript.trim() === '') {
    return err({ field: 'buildScript' });
  }
  return ok(undefined);
}
