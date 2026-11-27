import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';


export interface AttributeOwner<T> {
  readonly props?: Readonly<Record<string, T>> | undefined;
  readonly attrOrder?: readonly string[] | undefined;
}

export interface RenamedAttributes<T> {
  readonly props: Record<string, T>;
  readonly attrOrder?: string[];
}

export function renamedAttr<T>(node: AttributeOwner<T>, oldName: string, newName: string): RenamedAttributes<T> | undefined {
  const props = node.props;
  if (props === undefined || !Object.hasOwn(props, oldName)) {
    return undefined;
  }
  if (!newName || newName === oldName) {
    return undefined;
  }
  assert(Object.keys(props).length <= LIMITS.attrsPerNodeMax, 'Attribute count exceeds limit');
  assert(newName.length <= LIMITS.attrCharsMax, 'Attribute name exceeds limit');
  const next = Object.fromEntries(
    Object.entries(props).flatMap(([name, value]): [string, T][] => {
      if (name === oldName) {
        return [[newName, value]];
      }
      return name === newName ? [] : [[name, value]];
    }),
  );
  const order = node.attrOrder;
  if (order === undefined) {
    return { props: next };
  }
  const attrOrder = order.filter((name) => name !== newName).map((name) => (name === oldName ? newName : name));
  return { props: next, attrOrder };
}
