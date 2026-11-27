import ts from 'typescript';
import { assert } from '../../shared/core/assert';
import { PREVIEW_SCOPE_LIMITS, SCOPE_STORE_KEY } from '../../shared/page/previewScope';

export const SCOPE_CAPTURE_LIMITS = {
  bindingsMax: PREVIEW_SCOPE_LIMITS.namesMax,
  patternDepthMax: 16,
} as const;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const NON_DATA_MODULE = /\.(?:astro|css|scss|sass|less|styl|stylus|pcss|postcss)(?:\?.*)?$/i;
const STORE_LOCAL = '__stackiScope';

export function frontmatterBindings(frontmatter: string): readonly string[] {
  const file = parseFrontmatter(frontmatter);
  if (file === undefined) {
    return [];
  }
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (SCOPE_CAPTURE_LIMITS.bindingsMax <= names.size) {
      break;
    }
    if (ts.isImportDeclaration(statement)) {
      importBindings(statement, names);
    } else if (ts.isVariableStatement(statement)) {
      variableBindings(statement, names);
    }
  }
  const bindings = [...names].filter((name) => IDENTIFIER.test(name) && name !== STORE_LOCAL).slice(0, SCOPE_CAPTURE_LIMITS.bindingsMax);
  assert(bindings.length <= SCOPE_CAPTURE_LIMITS.bindingsMax, 'Captured bindings are bounded');
  return bindings;
}

export function scopeCaptureStatement(file: string, names: readonly string[]): string {
  assert(names.length > 0, 'A capture names at least one binding');
  assert(names.length <= SCOPE_CAPTURE_LIMITS.bindingsMax, 'A capture names a bounded number of bindings');
  for (const name of names) {
    assert(IDENTIFIER.test(name), 'A captured binding is an identifier');
    assert(name !== STORE_LOCAL, 'A captured binding is not the capture’s own local');
  }
  const key = JSON.stringify(SCOPE_STORE_KEY);
  const target = JSON.stringify(file);
  const getters = names.map((name) => `get ${name}(){return ${name}}`).join(',');
  return (
    `;{const ${STORE_LOCAL}=globalThis[Symbol.for(${key})]||(globalThis[Symbol.for(${key})]=new Map());` +
    `${STORE_LOCAL}.delete(${target});${STORE_LOCAL}.set(${target},{at:Date.now(),values:{${getters}}});` +
    `if(${STORE_LOCAL}.size>${PREVIEW_SCOPE_LIMITS.filesMax}){${STORE_LOCAL}.delete(${STORE_LOCAL}.keys().next().value)}}`
  );
}

export function withScopeCapture(marked: string, file: string): string {
  const fence = /\r?\n---\r?\n/.exec(marked.slice(3));
  if (!marked.startsWith('---') || fence === null) {
    return marked;
  }
  const close = 3 + fence.index;
  const names = frontmatterBindings(marked.slice(3, close));
  if (names.length === 0) {
    return marked;
  }
  const statement = scopeCaptureStatement(file, names);
  const captured = `${marked.slice(0, close)}\n${statement}${marked.slice(close)}`;
  assert(captured.startsWith('---'), 'The capture leaves the frontmatter fence first');
  assert(captured.length === marked.length + statement.length + 1, 'The capture only adds its own line');
  return captured;
}

function parseFrontmatter(frontmatter: string): ts.SourceFile | undefined {
  try {
    return ts.createSourceFile('frontmatter.ts', frontmatter, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      return undefined;
    }
    throw error;
  }
}

function importBindings(statement: ts.ImportDeclaration, names: Set<string>): void {
  const clause = statement.importClause;
  const from = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
  if (clause === undefined || clause.isTypeOnly || NON_DATA_MODULE.test(from)) {
    return;
  }
  if (clause.name !== undefined) {
    names.add(clause.name.text);
  }
  const named = clause.namedBindings;
  if (named === undefined) {
    return;
  }
  if (ts.isNamespaceImport(named)) {
    names.add(named.name.text);
    return;
  }
  for (const element of named.elements) {
    if (!element.isTypeOnly) {
      names.add(element.name.text);
    }
  }
}

function variableBindings(statement: ts.VariableStatement, names: Set<string>): void {
  const ambient = (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
  if (ambient) {
    return;
  }
  for (const declaration of statement.declarationList.declarations) {
    bindingNames(declaration.name, names, 0);
  }
}

function bindingNames(name: ts.BindingName, names: Set<string>, depth: number): void {
  assert(depth <= SCOPE_CAPTURE_LIMITS.patternDepthMax, 'Binding patterns nest within their bound');
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      if (depth < SCOPE_CAPTURE_LIMITS.patternDepthMax) {
        bindingNames(element.name, names, depth + 1);
      }
    }
  }
}
