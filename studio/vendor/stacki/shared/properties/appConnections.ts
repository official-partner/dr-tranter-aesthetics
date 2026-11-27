import { assert } from '../core/assert';

export const STACKI_CONNECTION_PROVIDER_IDS = ['google', 'hubspot'] as const;
export type StackiConnectionProviderId = (typeof STACKI_CONNECTION_PROVIDER_IDS)[number];

export interface StackiConnectionProvider {
  readonly label: string;
  readonly authorizeURL: string;
  readonly tokenURL: string;
  readonly pkce: boolean;
  readonly authorizeParams: Readonly<Record<string, string>>;
  readonly scopes: readonly string[];
  readonly loopbackClients: boolean;
}

export const STACKI_CONNECTION_PROVIDERS: { readonly [P in StackiConnectionProviderId]: StackiConnectionProvider } = {
  google: {
    label: 'Google',
    authorizeURL: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenURL: 'https://oauth2.googleapis.com/token',
    pkce: true,
    loopbackClients: true,
    authorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'],
  },
  hubspot: {
    label: 'HubSpot',
    authorizeURL: 'https://app.hubspot.com/oauth/authorize',
    tokenURL: 'https://api.hubapi.com/oauth/v1/token',
    pkce: false,
    loopbackClients: false,
    authorizeParams: {},
    scopes: [
      'oauth',
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
      'forms',
      'content',
      'scheduler.meetings.meeting-link.read',
    ],
  },
};

export const STACKI_BROKER_ORIGIN = 'https://stacki.build';

export function isStackiConnectionProvider(input: unknown): input is StackiConnectionProviderId {
  return STACKI_CONNECTION_PROVIDER_IDS.some((id) => id === input);
}

export function brokerRoutes(
  origin: string,
  provider: StackiConnectionProviderId,
): { readonly start: string; readonly token: string; readonly refresh: string; readonly status: string } {
  const base = `${parseBrokerOrigin(origin)}/api/oauth/${provider}`;
  return { start: `${base}/start`, token: `${base}/token`, refresh: `${base}/refresh`, status: `${base}/status` };
}

export function parseBrokerOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('The connections broker is not a URL');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('The connections broker is https, or http on this computer');
  }
  assert(url.origin.length > 0, 'A broker has an origin');
  return url.origin;
}

export function stackiBrokerOrigin(environment: Readonly<Record<string, string | undefined>>, build: 'release' | 'development'): string {
  const override = environment['STACKI_OAUTH_BROKER'];
  if (build === 'release' || override === undefined || override === '') {
    return STACKI_BROKER_ORIGIN;
  }
  return parseBrokerOrigin(override);
}
