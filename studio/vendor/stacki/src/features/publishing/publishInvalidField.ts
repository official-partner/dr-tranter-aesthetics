import { createContext, useContext } from 'react';
import type { MissingPublishField } from '../../../shared/properties/publishMissing';

export const PublishInvalidFieldContext = createContext<MissingPublishField | undefined>(undefined);

export function useIsInvalidPublishField(field: MissingPublishField): boolean {
  return useContext(PublishInvalidFieldContext) === field;
}
