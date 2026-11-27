
export interface BranchTree {
  readonly kind: string;
  readonly name?: string;
  readonly children?: readonly this[] | undefined;
}

const branchNamed = <Node extends BranchTree>(node: Node | undefined, name: 'then' | 'else'): Node | undefined => {
  if (!node || node.kind !== 'cond') {
    return undefined;
  }
  const kids = node.children ?? [];
  const found = kids.find((kid) => {
    return kid?.kind === 'branch' && (kid.name === 'else') === (name === 'else');
  });
  return found || undefined;
};

export function thenBranch<Node extends BranchTree>(node: Node | undefined): Node | undefined {
  return branchNamed(node, 'then');
}

export function elseBranch<Node extends BranchTree>(node: Node | undefined): Node | undefined {
  return branchNamed(node, 'else');
}

export function rowChildren<Node extends BranchTree>(node: Node | undefined): readonly Node[] {
  const then = thenBranch(node);
  if (!then) {
    return node?.children ?? [];
  }
  const otherwise = elseBranch(node);
  const kids = then.children ?? [];
  return otherwise ? [...kids, otherwise] : kids;
}

export function rowHost<Node extends BranchTree>(node: Node | undefined): Node | undefined {
  return thenBranch(node) || node;
}
