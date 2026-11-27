import { createContext } from 'react';
import type { AssetRequest } from './assetPick';

export const AssetPickPresentationContext = createContext<AssetRequest['presentation']>(undefined);
