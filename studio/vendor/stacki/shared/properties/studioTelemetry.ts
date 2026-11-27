
export const STUDIO_TELEMETRY_DISABLED = {
  ASTRO_TELEMETRY_DISABLED: '1',
  VERCEL_TELEMETRY_DISABLED: '1',
  NETLIFY_TELEMETRY_DISABLED: '1',
  WRANGLER_SEND_METRICS: 'false',
} as const satisfies Readonly<Record<string, string>>;

export function withStudioTelemetryDisabled(environment: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string | undefined>> {
  return { ...environment, ...STUDIO_TELEMETRY_DISABLED };
}
