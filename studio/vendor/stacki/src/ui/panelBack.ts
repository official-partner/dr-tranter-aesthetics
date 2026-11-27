import { createContext } from 'react';
import type { PanelHeaderBack } from './PanelHeader';

export const PanelBackContext = createContext<PanelHeaderBack | undefined>(undefined);
