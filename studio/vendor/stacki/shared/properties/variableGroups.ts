
export function prefixSections(names: readonly string[]): {
  loose: string[];
  sections: Map<string, string[]>;
} {
  const nameSet = new Set(names);
  const counts = new Map<string, number>();
  for (const name of names) {
    const body = name.replace(/^--/, '');
    const parts = body.split('-');
    for (let at = 1; at < parts.length; at++) {
      const prefix = parts.slice(0, at).join('-');
      if (nameSet.has(`--${prefix}`)) {
        continue;
      }
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
  }

  const qualifies = (prefix: string): boolean => (counts.get(prefix) || 0) >= 2;
  const assigned = new Map<string, string[]>();
  const loose: string[] = [];
  for (const name of names) {
    const body = name.replace(/^--/, '');
    const parts = body.split('-');
    let chosen: string | undefined = undefined;
    for (let at = 1; at < parts.length; at++) {
      const prefix = parts.slice(0, at).join('-');
      if (qualifies(prefix)) {
        chosen = prefix;
      }
    }
    if (!chosen) {
      loose.push(name);
      continue;
    }
    const group = assigned.get(chosen);
    if (group) {
      group.push(name);
    } else {
      assigned.set(chosen, [name]);
    }
  }

  const sections = new Map<string, string[]>();
  const orphans = new Set<string>();
  for (const [prefix, group] of assigned) {
    if (group.length >= 2) {
      sections.set(prefix, group);
    } else {
      group.forEach((name) => orphans.add(name));
    }
  }
  const mainList = names.filter((name) => loose.includes(name) || orphans.has(name));
  return { loose: mainList, sections };
}

export const shortLabel = (name: string, prefix?: string): string => {
  const body = name.replace(/^--/, '');
  return prefix && body.startsWith(`${prefix}-`) ? body.slice(prefix.length + 1) : body;
};

export interface NameBlock {
  readonly title: string | undefined;
  readonly names: readonly string[];
}

export function arrangeNames(names: readonly string[], shown: ReadonlySet<string>): readonly NameBlock[] {
  const { loose, sections } = prefixSections(names);
  if (sections.size === 0) {
    return [{ title: undefined, names: names.filter((name) => shown.has(name)) }].filter((block) => block.names.length > 0);
  }
  const blocks: NameBlock[] = [{ title: undefined, names: loose.filter((name) => shown.has(name)) }];
  for (const [prefix, members] of sections) {
    blocks.push({ title: prefix, names: members.filter((name) => shown.has(name)) });
  }
  return blocks.filter((block) => block.names.length > 0);
}
