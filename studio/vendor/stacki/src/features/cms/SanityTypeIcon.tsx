import { Icon as SanityIcon, icons, type IconSymbol } from '@sanity/icons';
import { CmsIcon } from '../../ui/Icons';
import { COLLECTIONS } from './remoteCmsCache';

export function SanityTypeIcon(props: { readonly symbol: string | undefined; readonly size: number }) {
  const { symbol } = props;
  if (symbol === undefined || !isSymbol(symbol)) {
    return <CmsIcon size={props.size} />;
  }
  return <SanityIcon symbol={symbol} className="sanity-type-icon" style={{ fontSize: Math.round(props.size * 1.35) }} />;
}

export function typeIcons(connectionId: string): ReadonlyMap<string, string> {
  const collections = COLLECTIONS.get(connectionId);
  const known = collections?.ok ? collections.value : [];
  return new Map(known.flatMap((collection) => (collection.icon === undefined ? [] : [[collection.name, collection.icon] as const])));
}

function isSymbol(symbol: string): symbol is IconSymbol {
  return Object.hasOwn(icons, symbol);
}
