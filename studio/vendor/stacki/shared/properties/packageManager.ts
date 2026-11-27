
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const CREATE_PACKAGE_MANAGERS = ['npm', 'pnpm', 'bun'] as const satisfies readonly PackageManager[];
export type CreatePackageManager = (typeof CREATE_PACKAGE_MANAGERS)[number];

const FIELD_CHARS_MAX = 256;

export function parseCreatePackageManager(input: unknown): CreatePackageManager {
  const manager = CREATE_PACKAGE_MANAGERS.find((candidate) => candidate === input);
  if (manager === undefined) {
    throw new Error(`Package manager: expected one of ${CREATE_PACKAGE_MANAGERS.join(', ')}`);
  }
  return manager;
}

export function scaffolderManager(manager: PackageManager): 'npm' | 'bun' {
  return manager === 'bun' ? 'bun' : 'npm';
}

export function packageManagerLabel(manager: PackageManager): string {
  switch (manager) {
    case 'npm':
      return 'npm';
    case 'pnpm':
      return 'pnpm';
    case 'yarn':
      return 'Yarn';
    case 'bun':
      return 'Bun';
    default: {
      const exhaustive: never = manager;
      return exhaustive;
    }
  }
}

export function parsePackageManagerField(input: unknown): PackageManager | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  if (input.length > FIELD_CHARS_MAX) {
    return undefined;
  }
  const at = input.indexOf('@');
  const name = at === -1 ? input : input.slice(0, at);
  return PACKAGE_MANAGERS.find((manager) => manager === name);
}
