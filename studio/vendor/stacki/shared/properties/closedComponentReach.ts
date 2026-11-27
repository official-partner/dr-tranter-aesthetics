
export const CLOSED_COMPONENT_REACHES = ['pending', 'prop', 'slot', 'internal'] as const;
export type ClosedComponentReach = (typeof CLOSED_COMPONENT_REACHES)[number];

export function isEditableThroughProps(reach: ClosedComponentReach): boolean {
  switch (reach) {
    case 'prop':
    case 'slot':
      return true;
    case 'pending':
    case 'internal':
      return false;
    default: {
      const exhaustive: never = reach;
      return exhaustive;
    }
  }
}

export function textReach(words: { readonly loaded: boolean; readonly covering: { readonly from?: 'slot' | 'prop' } | undefined }): ClosedComponentReach {
  const { loaded, covering } = words;
  if (!loaded) {
    return 'pending';
  }
  if (covering === undefined) {
    return 'internal';
  }
  switch (covering.from) {
    case 'prop':
      return 'prop';
    case 'slot':
      return 'slot';
    case undefined:
      return 'internal';
    default: {
      const exhaustive: never = covering.from;
      return exhaustive;
    }
  }
}
