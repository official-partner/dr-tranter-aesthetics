
import { useEffect, useState } from 'react';

export function useLiveColor(external: string): [string, (value: string | undefined) => void] {
  const [live, setLive] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLive(undefined);
  }, [external]);
  return [live ?? external, setLive];
}
