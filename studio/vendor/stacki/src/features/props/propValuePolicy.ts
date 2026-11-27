import { createContext } from 'react';

export type PropValuePolicy = 'instance' | 'defaults' | 'preview';
export const PropValuePolicyContext = createContext<PropValuePolicy>('instance');

export const PropHoverPreviewContext = createContext(true);
