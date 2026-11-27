
export const parentPath = (nodePath: string): string | undefined => {
  const bar = nodePath.lastIndexOf('|');
  const indexes = nodePath.slice(bar + 1);
  const dot = indexes.lastIndexOf('.');
  if (dot < 0) {
    return undefined;
  }
  if (!/^\d+(\.\d+)*$/.test(indexes)) {
    return undefined;
  }
  return nodePath.slice(0, bar + 1) + indexes.slice(0, dot);
};
