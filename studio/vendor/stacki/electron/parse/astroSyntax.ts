import ts from 'typescript';
import { assert } from '../../shared/core/assert';
import { PROPERTY_LIMITS } from '../../shared/properties/propertyEditing';

export function syntaxNodes(root: ts.Node): readonly ts.Node[] {
  const pending = [root];
  const output: ts.Node[] = [];
  for (let index = 0; index < pending.length; index += 1) {
    assert(pending.length <= PROPERTY_LIMITS.nodesMax, 'TypeScript node budget');
    const node = pending[index];
    assert(node !== undefined, 'Queued syntax node exists');
    output.push(node);
    node.forEachChild((child) => {
      pending.push(child);
    });
  }
  return output;
}

export function isAstroProps(node: ts.Node | undefined): boolean {
  if (!node) {
    return false;
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return isAstroPropsUnwrap(node);
  }
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Astro' && node.name.text === 'props';
}
const PROPS_WRAPPER_DEPTH_MAX = 128;
function isAstroPropsUnwrap(node: ts.Node): boolean {
  let current = node;
  for (let depth = 0; depth < PROPS_WRAPPER_DEPTH_MAX; depth += 1) {
    if (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else {
      return isAstroProps(current);
    }
  }
  assert(false, 'Astro.props wrapper depth is bounded');
}
