
import ts from 'typescript';
import { assert } from '../../../shared/core/assert';
import { PROP_MODEL_LIMITS, type PropsDeclaration } from '../../../shared/properties/propModel';
import type { DefaultRule, PropUnion, UnionBranch } from '../../../shared/properties/propSchema';
import { isAstroProps, syntaxNodes } from '../astroSyntax';
import { statedDefault } from './propProse';
import {
  PROP_TYPE_LIMITS,
  flattenParts,
  isNullish,
  literalOf,
  memberDocumentation,
  memberKey,
  referencedDeclaration,
  type FiledSignature,
  type TypeDeclaration,
  type TypeScope,
} from './propTypes';

export { memberDocumentation };

export interface PropsType {
  readonly declaration: PropsDeclaration;
  readonly blocks: readonly (readonly FiledSignature[])[];
  readonly unions: readonly PropUnion[];
}

export interface PropsPattern {
  readonly pattern: ts.ObjectBindingPattern;
  readonly annotation: ts.TypeNode | undefined;
}

export function readPropsType(frontmatter: ts.SourceFile, prelude: ts.SourceFile, scope: TypeScope, patterns: readonly PropsPattern[]): PropsType {
  const declared = propsDeclaration(frontmatter) ?? propsDeclaration(prelude);
  const asserted = assertedType(frontmatter);
  const blocks: (readonly FiledSignature[])[] = [];
  const unions: PropUnion[] = [];
  if (declared !== undefined) {
    if (ts.isInterfaceDeclaration(declared.node)) {
      for (const clause of declared.node.heritageClauses ?? []) {
        for (const heritage of clause.types) {
          heritageBlocks(heritage, scope, new Set(), blocks);
        }
      }
      blocks.push(declared.node.members.filter(ts.isPropertySignature).map((member) => ({ member, file: declared.file })));
    } else {
      typeBlocks(declared.node.type, declared.file, scope, new Set(), blocks);
      collectUnions(declared.node.type, declared.file, scope, new Set(), NO_SHARED, unions);
    }
  }
  if (asserted !== undefined) {
    const named = scope.declarations.get(asserted);
    if (named !== undefined) {
      declarationBlocks(named, scope, new Set([asserted]), blocks);
      if (named.kind === 'alias') {
        collectUnions(named.node.type, named.file, scope, new Set([asserted]), NO_SHARED, unions);
      }
    }
  }
  const annotation = declared === undefined && asserted === undefined ? patterns.find((entry) => entry.annotation !== undefined)?.annotation : undefined;
  if (annotation !== undefined) {
    typeBlocks(annotation, frontmatter, scope, new Set(), blocks);
  }
  return {
    declaration: declarationKind(declared, asserted, annotation),
    blocks,
    unions: unions.slice(0, PROP_MODEL_LIMITS.unionsMax),
  };
}

function declarationKind(declared: DeclaredProps | undefined, asserted: string | undefined, annotation: ts.TypeNode | undefined): PropsDeclaration {
  if (declared !== undefined) {
    return ts.isInterfaceDeclaration(declared.node) ? 'interface' : 'type';
  }
  if (asserted !== undefined) {
    return 'assertion';
  }
  return annotation === undefined ? 'none' : 'annotation';
}

interface DeclaredProps {
  readonly node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
  readonly file: ts.SourceFile;
}

function propsDeclaration(file: ts.SourceFile): DeclaredProps | undefined {
  for (const statement of file.statements) {
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === 'Props') {
      return { node: statement, file };
    }
  }
  return undefined;
}

function assertedType(frontmatter: ts.SourceFile): string | undefined {
  const found = syntaxNodes(frontmatter)
    .filter(ts.isAsExpression)
    .filter((node) => isAstroProps(node.expression) && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName))
    .sort((first, second) => first.pos - second.pos)[0];
  if (found === undefined || !ts.isTypeReferenceNode(found.type) || !ts.isIdentifier(found.type.typeName)) {
    return undefined;
  }
  return found.type.typeName.text;
}

function typeBlocks(node: ts.TypeNode, file: ts.SourceFile, scope: TypeScope, seen: Set<string>, out: (readonly FiledSignature[])[]): void {
  const aliasDepth = seen.size;
  if (aliasDepth > PROP_TYPE_LIMITS.aliasDepthMax) {
    return;
  }
  if (ts.isTypeLiteralNode(node)) {
    out.push(node.members.filter(ts.isPropertySignature).map((member) => ({ member, file })));
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    typeBlocks(node.type, file, scope, seen, out);
    return;
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const child of node.types) {
      typeBlocks(child, file, scope, seen, out);
    }
    return;
  }
  if (!ts.isTypeReferenceNode(node)) {
    return;
  }
  if (ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const declaration = scope.declarations.get(name);
    if (declaration !== undefined && !seen.has(name)) {
      seen.add(name);
      declarationBlocks(declaration, scope, seen, out);
    }
  }
  for (const argument of node.typeArguments ?? []) {
    typeBlocks(argument, file, scope, seen, out);
  }
}

function heritageBlocks(heritage: ts.ExpressionWithTypeArguments, scope: TypeScope, seen: Set<string>, out: (readonly FiledSignature[])[]): void {
  if (ts.isIdentifier(heritage.expression)) {
    const name = heritage.expression.text;
    const declaration = scope.declarations.get(name);
    if (declaration !== undefined && !seen.has(name) && seen.size <= PROP_TYPE_LIMITS.aliasDepthMax) {
      seen.add(name);
      declarationBlocks(declaration, scope, seen, out);
    }
  }
  for (const argument of heritage.typeArguments ?? []) {
    typeBlocks(argument, heritage.getSourceFile(), scope, seen, out);
  }
}

function declarationBlocks(declaration: TypeDeclaration, scope: TypeScope, seen: Set<string>, out: (readonly FiledSignature[])[]): void {
  if (declaration.kind === 'alias') {
    typeBlocks(declaration.node.type, declaration.file, scope, seen, out);
    return;
  }
  for (const clause of declaration.node.heritageClauses ?? []) {
    for (const heritage of clause.types) {
      heritageBlocks(heritage, scope, seen, out);
    }
  }
  out.push(declaration.node.members.filter(ts.isPropertySignature).map((member) => ({ member, file: declaration.file })));
}


const NO_SHARED: ReadonlySet<string> = new Set();

function collectUnions(node: ts.TypeNode, file: ts.SourceFile, scope: TypeScope, seen: Set<string>, shared: ReadonlySet<string>, out: PropUnion[]): void {
  const aliasDepth = seen.size;
  if (aliasDepth > PROP_TYPE_LIMITS.aliasDepthMax || out.length >= PROP_MODEL_LIMITS.unionsMax) {
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    collectUnions(node.type, file, scope, seen, shared, out);
    return;
  }
  if (ts.isIntersectionTypeNode(node)) {
    const declared = node.types.map((child) => sharedNames(child, scope));
    for (const [index, child] of node.types.entries()) {
      const beside = new Set(shared);
      for (const [other, names] of declared.entries()) {
        if (other !== index) {
          names.forEach((name) => beside.add(name));
        }
      }
      collectUnions(child, file, scope, seen, beside, out);
    }
    return;
  }
  if (ts.isUnionTypeNode(node) && node.types.length >= 2) {
    const branches = node.types.map((arm) => {
      const blocks: (readonly FiledSignature[])[] = [];
      typeBlocks(arm, file, scope, new Set(), blocks);
      return blocks;
    });
    if (branches.every((blocks) => blocks.length > 0)) {
      const union = unionTable(branches, scope, shared);
      if (union !== undefined) {
        out.push(union);
      }
      return;
    }
  }
  const declaration = referencedDeclaration(node, scope);
  if (declaration?.kind === 'alias' && !seen.has(declaration.node.name.text)) {
    seen.add(declaration.node.name.text);
    collectUnions(declaration.node.type, declaration.file, scope, seen, shared, out);
  }
}

function sharedNames(node: ts.TypeNode, scope: TypeScope): ReadonlySet<string> {
  const names = new Set<string>();
  const seen = new Set<string>();
  const work: ts.TypeNode[] = [node];
  for (let steps = 0; steps < PROP_MODEL_LIMITS.propsMax && work.length > 0; steps++) {
    const item = work.pop();
    assert(item !== undefined, 'sharedNames: a work item exists');
    if (ts.isParenthesizedTypeNode(item)) {
      work.push(item.type);
    } else if (ts.isIntersectionTypeNode(item)) {
      work.push(...item.types);
    } else if (ts.isTypeLiteralNode(item)) {
      addDeclaredNames(item.members, names);
    } else {
      const declaration = referencedDeclaration(item, scope);
      if (declaration !== undefined && !seen.has(declaration.node.name.text)) {
        seen.add(declaration.node.name.text);
        if (declaration.kind === 'alias') {
          work.push(declaration.node.type);
        } else {
          addDeclaredNames(declaration.node.members, names);
          const heritage = (declaration.node.heritageClauses ?? []).flatMap((clause) => clause.types);
          work.push(
            ...heritage.filter((type) => type.typeArguments === undefined).map((type) => ts.factory.createTypeReferenceNode(type.expression.getText())),
          );
        }
      }
    }
  }
  assert(seen.size <= PROP_MODEL_LIMITS.propsMax, 'sharedNames: each alias is followed once, within the step budget');
  return work.length === 0 ? names : NO_SHARED;
}

function addDeclaredNames(members: readonly ts.TypeElement[], names: Set<string>): void {
  for (const member of members) {
    if (ts.isPropertySignature(member) && member.type !== undefined && member.type.kind !== ts.SyntaxKind.NeverKeyword) {
      const name = memberKey(member.name);
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
}

function unionTable(branchBlocks: readonly (readonly (readonly FiledSignature[])[])[], scope: TypeScope, shared: ReadonlySet<string>): PropUnion | undefined {
  if (branchBlocks.length > PROP_MODEL_LIMITS.propVariantsMax) {
    return undefined;
  }
  const entries = branchBlocks.map((blocks) => {
    const members = new Map<string, FiledSignature>();
    const docs = new Map<string, string>();
    for (const signature of blocks.flat()) {
      const name = memberKey(signature.member.name);
      if (name === undefined) {
        continue;
      }
      members.set(name, signature);
      const documentation = memberDocumentation(signature).slice(0, PROP_MODEL_LIMITS.docCharsMax);
      if (documentation !== '') {
        docs.set(name, documentation);
      }
    }
    return { members, docs };
  });
  const names = [...new Set(entries.flatMap((entry) => [...entry.members.keys()]))];
  const branches = entries.map(({ members, docs }) => {
    const forbids: string[] = [];
    const pins: Record<string, readonly string[]> = {};
    for (const name of names) {
      const signature = members.get(name);
      const type = signature?.member.type;
      if (signature === undefined || type === undefined) {
        continue;
      }
      if (type.kind === ts.SyntaxKind.NeverKeyword) {
        forbids.push(name);
        continue;
      }
      const values = flattenParts(type, signature.file, scope).filter((part) => !isNullish(part));
      const literals = values.map(literalOf);
      if (
        values.length > 0 &&
        values.length <= PROP_MODEL_LIMITS.optionsMax &&
        literals.every((literal) => literal !== undefined && literal.text.length <= PROP_MODEL_LIMITS.textCharsMax)
      ) {
        pins[name] = literals.map((literal) => (literal?.form === 'string' ? literal.value : (literal?.text ?? '')));
      }
    }
    return { forbids, pins, ...branchDocs(docs) };
  });
  const told = discriminated(branches.map((branch) => branch.pins));
  const finished: UnionBranch[] = branches.map((branch, index) => {
    const members = entries[index]?.members;
    assert(members !== undefined, 'unionTable: every branch has its members');
    const missing = told ? names.filter((name) => !members.has(name) && !branch.forbids.includes(name) && !shared.has(name)) : [];
    return { ...branch, forbids: [...branch.forbids, ...missing] };
  });
  const telling = finished.some(
    (branch) =>
      branch.forbids.length > 0 || Object.keys(branch.pins).length > 0 || Object.keys(branch.defaults).length > 0 || Object.keys(branch.rules).length > 0,
  );
  return telling ? { names, branches: finished } : undefined;
}

function branchDocs(documentation: ReadonlyMap<string, string>): Pick<UnionBranch, 'defaults' | 'rules' | 'docs'> {
  const defaults: Record<string, string | number> = {};
  const rules: Record<string, DefaultRule> = {};
  const docs: Record<string, string> = {};
  for (const [name, text] of documentation) {
    docs[name] = text;
    const said = statedDefault(text);
    if (said.value !== undefined) {
      defaults[name] = said.value;
    }
    if (said.when) {
      rules[name] = said.when;
    }
  }
  return { defaults, rules, docs };
}

function discriminated(pins: readonly Readonly<Record<string, readonly string[]>>[]): boolean {
  const names = new Set(pins.flatMap((branch) => Object.keys(branch)));
  for (const name of names) {
    const pinned = pins.map((branch) => branch[name]).filter((values) => values !== undefined);
    const values = pinned.flat();
    if (pinned.length >= 2 && pinned.length === pins.length && new Set(values).size === values.length) {
      return true;
    }
  }
  return false;
}

export function splitFallbacks(unions: readonly PropUnion[]): ReadonlySet<string> {
  const split = new Set<string>();
  for (const union of unions) {
    for (const name of union.names) {
      const seen = new Set<string | number>();
      for (const branch of union.branches) {
        const value = branch.defaults[name];
        if (value !== undefined) {
          seen.add(value);
        }
        if (branch.rules[name] !== undefined) {
          seen.add(`rule:${name}`);
        }
      }
      if (seen.size > 1) {
        split.add(name);
      }
    }
  }
  return split;
}
