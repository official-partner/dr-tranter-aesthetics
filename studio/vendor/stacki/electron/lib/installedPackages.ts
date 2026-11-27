
export function isInstalledFile(file: string): boolean {
  return file.split(/[\\/]/).some((segment) => segment.toLowerCase() === 'node_modules');
}

export function packageOf(file: unknown): string | undefined {
  const normalized = '/' + String(file || '').replace(/\\/g, '/');
  const at = normalized.lastIndexOf('/node_modules/');
  if (at === -1) {
    return undefined;
  }
  const match = normalized.slice(at + '/node_modules/'.length).match(/^((?:@[^/]+\/)?[^/]+)/);
  return match?.[1];
}
