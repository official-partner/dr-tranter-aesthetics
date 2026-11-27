
export const CAPABILITIES = [
  'editable',
  'read-only-opaque',
  'repeated-source-node',
  'runtime-aggregate',
  'unsupported',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function parseCapability(input: unknown): Capability {
  for (const capability of CAPABILITIES) {
    if (capability === input) {
      return capability;
    }
  }
  throw new Error(`Capability: unknown value ${JSON.stringify(input)}`);
}

export function capabilityAcceptsVisualIntent(capability: Capability): boolean {
  switch (capability) {
    case 'editable':
    case 'repeated-source-node':
      return true;
    case 'read-only-opaque':
    case 'runtime-aggregate':
    case 'unsupported':
      return false;
    default: {
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}

export function capabilityAcceptsNodeRewrite(capability: Capability): boolean {
  switch (capability) {
    case 'editable':
    case 'read-only-opaque':
    case 'repeated-source-node':
      return true;
    case 'runtime-aggregate':
    case 'unsupported':
      return false;
    default: {
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}

export function describeCapability(capability: Capability): string {
  switch (capability) {
    case 'editable':
      return 'Editable';
    case 'read-only-opaque':
      return 'Code';
    case 'repeated-source-node':
      return 'Repeated by a loop — an edit here changes every item';
    case 'runtime-aggregate':
      return 'Assembled from several files — edit each source file';
    case 'unsupported':
      return 'Stacki encountered an error identifying this element';
    default: {
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}
