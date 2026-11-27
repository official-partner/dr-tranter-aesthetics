export function publishEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of [
    'STUDIO_CONTAINER_TOKEN',
    'STUDIO_BACKEND_URL',
    'GITHUB_PRIVATE_KEY',
    'GITHUB_APP_ID',
    'GITHUB_INSTALLATION_ID',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'AI_API_KEY',
  ]) {
    delete environment[name];
  }
  return environment;
}

export function netlifyEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...publishEnvironment(),
    CI: 'true',
    NO_COLOR: '1',
    NETLIFY_TELEMETRY_DISABLED: '1',
    NO_UPDATE_NOTIFIER: '1',
    BROWSER: 'none',
  };
  delete environment['NETLIFY_SITE_ID'];
  return environment;
}
