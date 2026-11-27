import { readPropertyOrigins } from './propertyOrigins';
import { readPropertyContracts } from './propertyContracts';
import type { PropertyContracts } from './propertyContracts';
import type { PropertyOrigins } from './propertyOrigins';
import type { ModelSchemaField } from '../../shared/properties/propModelSchema';
import { schemaFieldsOf } from '../../shared/properties/propModelSchema';
import { readPropModel } from '../parse/propModel/readPropModel';
import { createPropertyTypeReader, optionAliasOf, optionAliasWarning } from './propertyTypes';
import { literalOptions } from '../../shared/properties/propertyOptions';
import { bindComponentDefault, renamePropertyLocal } from './propertyRename';
import type { PropertyRename } from './propertyRename';
import ts from 'typescript';
import { assert } from '../../shared/core/assert';
import { indentUnitOf, withIndentUnit } from '../../shared/core/indent';
import type { ComponentProperties, ComponentProperty, PropertyChange, PropertyEditing } from '../../shared/properties/propertyEditing';
import { PROPERTY_LIMITS } from '../../shared/properties/propertyEditing';
import { refusal } from '../../shared/properties/propertyErrors';
import { err, ok, type Result } from '../../shared/core/result';
import {
  applySourceEdits,
  defaultExpression,
  isAstroProps,
  propertyKey,
  propertyNameText,
  readPropertySyntax,
  replaceFrontmatter,
  syntaxError,
  syntaxNodes,
  validatePropertyCode,
} from './propertySyntax';
import type { PropertySyntax, SourceEdit } from './propertySyntax';
import { editVariantRules } from './variantRuleEdits';
import { readVariantSyntax, variantGroupsOf } from './variantRuleModel';
import { readVariantDefaults } from './variantDefaults';
import { orderDefaultReads } from './defaultOrder';
import { bindingEdits, memberComment, memberEdits, sameDeclaration, sameProperty } from './propertyMemberEdits';
import type { DeclaredFields } from './propertyMemberEdits';
import { declareInHost } from './propertyHosts';
import { propertyReadLines } from './propertyReads';
import type { PropertyKeptConstant, PropertyKeptSource } from '../../shared/properties/propertyRemoval';

interface Definitions {
  readonly document: PropertySyntax;
  readonly readType: (type: ts.TypeNode) => string;
  readonly members: readonly ts.PropertySignature[];
  readonly bindings: readonly ts.BindingElement[];
  readonly patterns: readonly ts.ObjectBindingPattern[];
  readonly container: ts.InterfaceDeclaration | ts.TypeLiteralNode | undefined;
  readonly advanced: boolean;
  readonly others: readonly ts.PropertySignature[];
}

export function readComponentProperties(source: string): ComponentProperties {
  const definitions = readDefinitions(source);
  const origins = readPropertyOrigins(definitions.document);
  const fields = readDefinitionFields(definitions);
  const contracts = readPropertyContracts(definitions.document);
  return {
    source,
    properties: [...fields.values()].map((property) => sourcedProperty(property, definitions, origins, contracts)),
    frontmatter: definitions.document.frontmatter,
    advanced: definitions.advanced,
    variantGroups: variantGroupsOf(readVariantSyntax(definitions.document)),
    variantDefaults: readVariantDefaults(definitions.document),
  };
}

function readDefinitionFields(definitions: Definitions): ReadonlyMap<string, ComponentProperty> {
  const fields = new Map<string, ComponentProperty>();
  const names = new Set([
    ...definitions.members.map((member) => propertyKey(member.name)),
    ...definitions.bindings.map((binding) => propertyKey(binding.propertyName ?? binding.name)),
  ]);
  const model = readPropModel(definitions.document.source);
  for (const field of schemaFieldsOf(model)) {
    const prop = model.props.find((entry) => entry.name === field.name);
    assert(prop !== undefined, 'Every schema field has its prop');
    if (!definitions.advanced && !names.has(field.name) && prop.declared) {
      continue;
    }
    fields.set(field.name, {
      name: field.name,
      type: schemaPropertyType(field),
      required: !field.optional,
      readonly: false,
      defaultValue: '',
      description: field.doc ?? '',
    });
  }
  for (const member of definitions.members) {
    const name = propertyKey(member.name);
    if (!name) {
      continue;
    }
    fields.set(name, {
      name,
      type: member.type ? definitions.readType(member.type) : 'unknown',
      required: member.questionToken === undefined,
      readonly: member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
      defaultValue: '',
      description: readDescription(member, definitions.document.frontmatter),
    });
  }
  for (const binding of definitions.bindings) {
    const name = propertyKey(binding.propertyName ?? binding.name);
    if (!name) {
      continue;
    }
    const previous = fields.get(name);
    fields.set(name, {
      name,
      type: previous?.type ?? 'unknown',
      required: previous?.required ?? false,
      readonly: previous?.readonly ?? false,
      description: previous?.description ?? '',
      defaultValue: binding.initializer?.getText() ?? '',
    });
  }
  const merged = propsObjectDeclaration(definitions.document.syntax)?.initializer;
  if (merged !== undefined && ts.isObjectLiteralExpression(merged)) {
    for (const item of merged.properties) {
      const key = ts.isPropertyAssignment(item) ? propertyKey(item.name) : undefined;
      const field = key === undefined ? undefined : fields.get(key);
      if (key !== undefined && field !== undefined && ts.isPropertyAssignment(item) && field.defaultValue === '') {
        fields.set(key, { ...field, defaultValue: item.initializer.getText() });
      }
    }
  }
  assert(fields.size <= PROPERTY_LIMITS.fieldsMax, 'Component field count is bounded');
  assert(new Set(fields.keys()).size === fields.size, 'Component property names are unique');
  return fields;
}

function schemaPropertyType(field: ModelSchemaField): string {
  if (field.type === 'enum' && field.options?.length) {
    return field.options.map((value) => (field.numeric ? value : JSON.stringify(value))).join(' | ');
  }
  return ['enum', 'other', 'code', 'attrs', 'slot', 'style'].includes(field.type) ? 'unknown' : field.type || 'unknown';
}

function sourcedProperty(property: ComponentProperty, definitions: Definitions, origins: PropertyOrigins, contracts: PropertyContracts): ComponentProperty {
  const binding = definitions.bindings.find((item) => propertyKey(item.propertyName ?? item.name) === property.name);
  const conditions = contracts.conditions(property.name);
  const traced = origins.members.get(property.name) ?? [];
  const types = (traced.length > 0 ? traced : (contracts.declared.get(property.name) ?? []))
    .flatMap((member) => (member.type ? [definitions.readType(member.type)] : []))
    .filter((type) => type !== 'never');
  const member = contracts.primary.get(property.name);
  return {
    ...property,
    ...(member
      ? {
          required: member.questionToken === undefined,
          readonly: member.modifiers?.some((item) => item.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
          description: readDescription(member, definitions.document.frontmatter),
        }
      : {}),
    type: definitions.advanced && types.length ? [...new Set(types)].join(' | ') : property.type,
    origin: origins.origin(property.name, binding),
    editing: withAliasWarning(
      definitions.advanced ? contracts.editing(property.name) : { kind: 'editable' },
      member ?? definitions.members.find((item) => propertyKey(item.name) === property.name),
      definitions.document.syntax,
    ),
    conditions: conditions.map((condition) => condition.message),
    conditionRefs: conditions.map((condition) => condition.messageRef),
  };
}

function withAliasWarning(editing: PropertyEditing, member: ts.PropertySignature | undefined, syntax: ts.SourceFile): PropertyEditing {
  if (editing.kind !== 'editable' || member === undefined) {
    return editing;
  }
  const alias = optionAliasOf(syntax, member);
  const warning = alias === undefined ? undefined : optionAliasWarning(alias);
  return warning === undefined ? editing : { kind: 'editable', warning: warning.message, warningRef: warning.messageRef };
}

export function editPropertyDefinition(source: string, change: PropertyChange): Result<string> {
  const rename = localRename(source, change);
  if (rename === undefined) {
    return editDefinition(source, change);
  }
  const edited = editDefinition(source, change);
  if (!edited.ok) {
    if (edited.error.code !== 'syntax') {
      return edited;
    }
  }
  const local = renamePropertyLocal(source, rename);
  return local.ok ? editDefinition(local.value, change) : local;
}

function localRename(source: string, change: PropertyChange): PropertyRename | undefined {
  if (change.kind !== 'save') {
    return undefined;
  }
  const from = change.originalName;
  if (from === '' || from === change.property.name) {
    return undefined;
  }
  const binding = readDefinitions(source).bindings.find((item) => propertyKey(item.propertyName ?? item.name) === from);
  if (binding === undefined) {
    return undefined;
  }
  return ts.isIdentifier(binding.name) && binding.name.text === from ? { from, to: change.property.name } : undefined;
}

function editDefinition(source: string, change: PropertyChange): Result<string> {
  const edited = editDefinitionText(source, change);
  if (edited.ok && change.kind === 'save' && edited.value !== source) {
    return orderDefaultReads(
      edited.value,
      change.property.name,
      readComponentProperties(edited.value).properties.map((property) => property.name),
    );
  }
  return edited;
}

function editDefinitionText(source: string, change: PropertyChange): Result<string> {
  const definitions = readDefinitions(source);
  if (change.kind === 'source') {
    const error = syntaxError(change.frontmatter);
    if (error) {
      return err({ code: 'syntax', message: error });
    }
    return ok(replaceFrontmatter(definitions.document, change.frontmatter.replace(/\s*$/, '\n')));
  }
  if (change.kind === 'variantRules') {
    return editVariantRules(source, change.edit);
  }
  if (definitions.advanced) {
    return editCommonDefinition(definitions, change);
  }
  if (change.kind === 'order') {
    return reorderDefinitions(definitions, change.names);
  }
  if (change.kind === 'options') {
    return saveDefinitionOptions(definitions, change.name, change.type);
  }
  if (change.kind === 'remove') {
    return removeDefinition(definitions, change.name);
  }
  return saveDefinition(definitions, change.originalName, change.property);
}

function editCommonDefinition(definitions: Definitions, change: Exclude<PropertyChange, { readonly kind: 'source' | 'variantRules' }>): Result<string> {
  if (change.kind === 'order') {
    return reorderDefinitions(definitions, change.names);
  }
  const name = change.kind === 'save' ? change.originalName : change.name;
  const common = commonDefinitions(definitions, name);
  if (change.kind === 'remove') {
    return removeDefinition(common, name);
  }
  if (change.kind === 'options') {
    return saveDefinitionOptions(common, name, change.type);
  }
  return saveDefinition(common, name, change.property);
}

function commonDefinitions(definitions: Definitions, name: string): Definitions {
  const contracts = readPropertyContracts(definitions.document);
  const declared = contracts.declared.get(name) ?? [];
  const [primary, ...others] = declared;
  return { ...definitions, members: primary === undefined ? [] : [primary], others };
}

function readDefinitions(source: string): Definitions {
  const document = readPropertySyntax(source);
  const declarations = document.syntax.statements.filter(
    (statement): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === 'Props',
  );
  const declaration = declarations[0];
  const container = definitionContainer(declaration) ?? (declarations.length === 0 ? annotationContainer(document.syntax) : undefined);
  const members = container?.members.filter(ts.isPropertySignature) ?? [];
  const aliases = plainAliases(document.syntax);
  const patterns = syntaxNodes(document.syntax)
    .filter(ts.isVariableDeclaration)
    .filter(
      (node) => isAstroProps(node.initializer) || (node.initializer !== undefined && ts.isIdentifier(node.initializer) && aliases.has(node.initializer.text)),
    )
    .map((node) => node.name)
    .filter(ts.isObjectBindingPattern);
  const bindings = patterns.flatMap((pattern) => pattern.elements).filter((binding) => !binding.dotDotDotToken);
  const typedProps = syntaxNodes(document.syntax).some((node) => ts.isAsExpression(node) && isAstroProps(node.expression) && node.type.getText() !== 'Props');
  const imported = document.syntax.statements.some((statement) => ts.isImportDeclaration(statement) && statement.importClause?.getText().match(/\bProps\b/));
  const annotatedType = syntaxNodes(document.syntax)
    .filter(ts.isVariableDeclaration)
    .find((node) => isAstroProps(node.initializer) && ts.isObjectBindingPattern(node.name) && node.type !== undefined)?.type;
  const advanced =
    declarations.length > 1 ||
    (annotatedType !== undefined && declarations.length === 0 && !ts.isTypeLiteralNode(annotatedType)) ||
    imported ||
    typedProps ||
    (declaration !== undefined && ts.isTypeAliasDeclaration(declaration) && declaration.typeParameters !== undefined) ||
    (declaration !== undefined && ts.isTypeAliasDeclaration(declaration) && !ts.isTypeLiteralNode(declaration.type)) ||
    (container !== undefined && container.members.length !== members.length) ||
    (container !== undefined && ts.isInterfaceDeclaration(container) && container.typeParameters !== undefined) ||
    members.some((member) => !/^[A-Za-z_$][\w$]*$/.test(propertyKey(member.name) ?? '')) ||
    bindings.some((binding) => !ts.isIdentifier(binding.name)) ||
    patterns.length > 1;
  return {
    document,
    readType: createPropertyTypeReader(document.syntax),
    members,
    patterns,
    bindings,
    container,
    advanced,
    others: [],
  };
}

function plainAliases(syntax: ts.SourceFile): ReadonlySet<string> {
  return new Set(
    syntaxNodes(syntax)
      .filter(ts.isVariableDeclaration)
      .filter((node) => ts.isIdentifier(node.name) && isAstroProps(node.initializer))
      .map((node) => node.name.getText()),
  );
}

function propsObjectDeclaration(syntax: ts.SourceFile): ts.VariableDeclaration | undefined {
  return syntaxNodes(syntax)
    .filter(ts.isVariableDeclaration)
    .find((node) => {
      if (!ts.isIdentifier(node.name) || node.initializer === undefined) {
        return false;
      }
      if (isAstroProps(node.initializer)) {
        return true;
      }
      return (
        ts.isObjectLiteralExpression(node.initializer) &&
        node.initializer.properties.some((item) => ts.isSpreadAssignment(item) && isAstroProps(item.expression))
      );
    });
}

function mergedDefaultEdit(declaration: ts.VariableDeclaration, name: string, expression: string): SourceEdit | undefined {
  const initializer = declaration.initializer;
  assert(initializer !== undefined, 'A props object has an initializer');
  const key = propertyNameText(name);
  const value = defaultExpression(expression);
  if (!ts.isObjectLiteralExpression(initializer)) {
    const whole = initializer.getText();
    const spread = ts.isPropertyAccessExpression(initializer) ? whole : `(${whole})`;
    return { start: initializer.getStart(), end: initializer.end, text: `{ ${key}: ${value}, ...${spread} }` };
  }
  const existing = initializer.properties.find((item) => ts.isPropertyAssignment(item) && propertyKey(item.name) === name);
  if (existing !== undefined && ts.isPropertyAssignment(existing)) {
    return { start: existing.initializer.getStart(), end: existing.initializer.end, text: value };
  }
  const spread = initializer.properties.find((item) => ts.isSpreadAssignment(item) && isAstroProps(item.expression));
  return spread === undefined ? undefined : { start: spread.getStart(), end: spread.getStart(), text: `${key}: ${value}, ` };
}

function annotationContainer(syntax: ts.SourceFile): ts.TypeLiteralNode | undefined {
  const annotated = syntaxNodes(syntax)
    .filter(ts.isVariableDeclaration)
    .filter((node) => isAstroProps(node.initializer) && ts.isObjectBindingPattern(node.name));
  const type = annotated.length === 1 ? annotated[0]?.type : undefined;
  return type !== undefined && ts.isTypeLiteralNode(type) ? type : undefined;
}

function definitionContainer(
  declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined,
): ts.InterfaceDeclaration | ts.TypeLiteralNode | undefined {
  if (!declaration || ts.isInterfaceDeclaration(declaration)) {
    return declaration;
  }
  if (ts.isTypeLiteralNode(declaration.type)) {
    return declaration.type;
  }
  if (!ts.isIntersectionTypeNode(declaration.type)) {
    return undefined;
  }
  const literals = declaration.type.types.filter(ts.isTypeLiteralNode);
  return literals.length === 1 ? literals[0] : undefined;
}

function readDescription(member: ts.PropertySignature, source: string): string {
  return memberComment(source, member)?.description ?? '';
}

function renderDefinition(property: ComponentProperty): string {
  const documentation = property.description.trim();
  const description = documentation ? `\t/** ${documentation.replace(/\*\//g, '* /').replace(/\n/g, '\n\t * ')} */\n` : '';
  return `\n${description}\t${property.readonly ? 'readonly ' : ''}${propertyNameText(property.name)}` + `${property.required ? '' : '?'}: ${property.type};`;
}

function inlineDefinition(property: ComponentProperty): string {
  const documentation = property.description
    .trim()
    .replace(/\*\//g, '* /')
    .replace(/\s*\n\s*/g, ' ');
  const comment = documentation ? `/** ${documentation} */ ` : '';
  return `${comment}${property.readonly ? 'readonly ' : ''}${propertyNameText(property.name)}${property.required ? '' : '?'}: ${property.type}`;
}
function saveDefinition(definitions: Definitions, originalName: string, property: ComponentProperty): Result<string> {
  const valid = validatePropertyCode(property.type, property.defaultValue);
  if (!valid.ok) {
    return valid;
  }
  const snapshot = readComponentProperties(definitions.document.source);
  const previous = originalName ? snapshot.properties.find((field) => field.name === originalName) : undefined;
  if (originalName && previous === undefined) {
    return err(refusal('missing', 'props.edit.missing'));
  }
  if (originalName !== property.name && snapshot.properties.some((field) => field.name === property.name)) {
    return err(refusal('duplicate', 'props.edit.duplicate', { name: property.name }));
  }
  if (!originalName && snapshot.properties.length >= PROPERTY_LIMITS.fieldsMax) {
    return err(refusal('limit', 'props.edit.limit'));
  }
  if (previous !== undefined && sameProperty(previous, property)) {
    return ok(definitions.document.source);
  }
  const declaration = declarationEdits(definitions, originalName, previous, property);
  if (!declaration.ok) {
    return declaration;
  }
  const merged = mergedDefault(definitions, originalName, previous, property);
  const binding = merged === undefined ? saveDefinitionBinding(definitions, originalName, previous, property) : ok(merged);
  if (!binding.ok) {
    return binding;
  }
  const frontmatter = applySourceEdits(definitions.document.frontmatter, [...declaration.value, ...binding.value]);
  const error = syntaxError(frontmatter);
  if (error) {
    return err({ code: 'syntax', message: error });
  }
  const output = replaceFrontmatter(definitions.document, frontmatter);
  assert(output !== definitions.document.source || previous === undefined || !sameProperty(previous, property), 'A changed save writes its change');
  const defaultChanged = property.defaultValue.trim() !== (previous?.defaultValue.trim() ?? '');
  const bound = definitions.bindings.some((item) => propertyKey(item.propertyName ?? item.name) === originalName);
  if (property.defaultValue.trim() && defaultChanged && originalName !== '' && merged === undefined) {
    const existing = definitions.bindings.find((item) => propertyKey(item.propertyName ?? item.name) === originalName);
    if (existing !== undefined && !ts.isIdentifier(existing.name)) {
      return ok(output);
    }
    const local = existing?.name.getText() ?? bindingFor(definitions, property.name);
    const aliased = bindComponentDefault(output, originalName, local);
    return aliased.ok || !bound ? aliased : ok(output);
  }
  return ok(output);
}

function mergedDefault(
  definitions: Definitions,
  originalName: string,
  previous: ComponentProperty | undefined,
  property: ComponentProperty,
): readonly SourceEdit[] | undefined {
  const fallback = property.defaultValue.trim();
  const declaration = propsObjectDeclaration(definitions.document.syntax);
  const bound = definitions.bindings.some((item) => propertyKey(item.propertyName ?? item.name) === originalName);
  if (declaration === undefined || bound || fallback === '' || fallback === (previous?.defaultValue.trim() ?? '')) {
    return undefined;
  }
  const edit = mergedDefaultEdit(declaration, originalName || property.name, fallback);
  return edit === undefined ? undefined : [edit];
}

function declarationEdits(
  definitions: Definitions,
  originalName: string,
  previous: ComponentProperty | undefined,
  property: ComponentProperty,
): Result<readonly SourceEdit[]> {
  const member = definitions.members.find((item) => propertyKey(item.name) === originalName);
  if (member) {
    assert(previous !== undefined, 'A declared member was read before its save');
    const alias = optionAliasOf(definitions.document.syntax, member);
    const target = alias !== undefined && literalOptions(property.type) !== undefined ? alias.declaration.type : member.type;
    const frontmatter = definitions.document.frontmatter;
    const others = definitions.others.flatMap((other) => memberEdits(frontmatter, other, ...otherDeclaration(definitions, other, previous, property)));
    return ok([...memberEdits(frontmatter, member, previous, property, target), ...others]);
  }
  if (previous !== undefined && sameDeclaration(previous, property)) {
    return ok([]);
  }
  if (definitions.container) {
    return ok([
      {
        start: definitions.container.end - 1,
        end: definitions.container.end - 1,
        text: withIndentUnit(renderDefinition(property), indentUnitOf(definitions.document.frontmatter)) + '\n',
      },
    ]);
  }
  if (previous === undefined && LOOSE_TYPES.has(property.type.trim()) && !property.description.trim() && !property.required && !property.readonly) {
    return ok([]);
  }
  const hosted = declareInHost(definitions.document.syntax, {
    block: withIndentUnit(renderDefinition(property), indentUnitOf(definitions.document.frontmatter)) + '\n',
    inline: inlineDefinition(property),
  });
  if (hosted !== undefined) {
    return hosted;
  }
  const snapshot = readComponentProperties(definitions.document.source);
  const fields =
    previous === undefined ? [...snapshot.properties, property] : snapshot.properties.map((field) => (field.name === originalName ? property : field));
  return ok([{ start: 0, end: 0, text: newPropsInterface(definitions, fields.map(renderDefinition).join('')) }]);
}

function otherDeclaration(
  definitions: Definitions,
  member: ts.PropertySignature,
  previous: ComponentProperty,
  property: ComponentProperty,
): [DeclaredFields, DeclaredFields] {
  const own: DeclaredFields = {
    name: previous.name,
    type: member.type ? definitions.readType(member.type) : 'unknown',
    required: member.questionToken === undefined,
    readonly: member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
    description: readDescription(member, definitions.document.frontmatter),
  };
  if (own.type === 'never') {
    return [own, { ...own, name: property.name }];
  }
  return [
    own,
    {
      name: property.name,
      type: property.type === previous.type ? own.type : property.type,
      required: property.required === previous.required ? own.required : property.required,
      readonly: property.readonly === previous.readonly ? own.readonly : property.readonly,
      description: own.description,
    },
  ];
}

function newPropsInterface(definitions: Definitions, members: string): string {
  const forwards = definitions.patterns.some((pattern) => pattern.elements.some((element) => element.dotDotDotToken !== undefined));
  const indent = indentUnitOf(definitions.document.frontmatter);
  const attributes = forwards ? withIndentUnit('\n\t[attribute: string]: unknown;', indent) : '';
  return withIndentUnit(`interface Props {${members}`, indent) + `${attributes}\n}\n`;
}

const LOOSE_TYPES = new Set(['', 'unknown']);

function saveDefinitionOptions(definitions: Definitions, name: string, type: string): Result<string> {
  const property = readComponentProperties(definitions.document.source).properties.find((field) => field.name === name);
  if (!property) {
    return err(refusal('missing', 'props.edit.missing'));
  }
  assert(property.name === name, 'Option reorder targets the requested property');
  assert(type.length <= PROPERTY_LIMITS.textCharsMax, 'Option type is bounded');
  return saveDefinition(definitions, name, { ...property, type });
}

function saveDefinitionBinding(
  definitions: Definitions,
  originalName: string,
  previous: ComponentProperty | undefined,
  property: ComponentProperty,
): Result<readonly SourceEdit[]> {
  const binding = definitions.bindings.find((item) => propertyKey(item.propertyName ?? item.name) === originalName);
  if (binding) {
    assert(previous !== undefined, 'A destructured prop was read before its save');
    return ok(bindingEdits(binding, previous, property));
  }
  const fallback = property.defaultValue.trim() ? ` = ${defaultExpression(property.defaultValue.trim())}` : '';
  if (!fallback && originalName) {
    return ok([]);
  }
  const local = bindingFor(definitions, property.name);
  const entry = local === property.name && propertyNameText(property.name) === property.name ? property.name : `${propertyNameText(property.name)}: ${local}`;
  const pattern = definitions.patterns[0];
  if (pattern) {
    const first = pattern.elements[0];
    const position = first?.getStart() ?? pattern.end - 1;
    return ok([{ start: position, end: position, text: `${entry}${fallback}${first ? ', ' : ''}` }]);
  }
  const position = firstCodeStart(definitions.document.syntax);
  return ok([
    {
      start: position,
      end: position,
      text:
        position === definitions.document.frontmatter.length
          ? `\nconst { ${entry}${fallback} } = Astro.props;\n`
          : `const { ${entry}${fallback} } = Astro.props;\n`,
    },
  ]);
}

const RESERVED_WORDS: ReadonlySet<string> = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with'.split(
    ' ',
  ),
);

function firstCodeStart(syntax: ts.SourceFile): number {
  const code = syntax.statements.find(
    (statement) => !ts.isImportDeclaration(statement) && !ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement),
  );
  return code === undefined ? syntax.end : code.getStart();
}

function terminated(chunk: string): string {
  return /[;,]\s*$/.test(chunk) ? chunk : `${chunk.trimEnd()};`;
}

function bindingFor(definitions: Definitions, name: string): string {
  const taken = new Set(
    syntaxNodes(definitions.document.syntax)
      .filter(ts.isIdentifier)
      .filter((node) => !ts.isPropertySignature(node.parent))
      .map((node) => node.text),
  );
  const base = bindingLocal(name);
  for (let attempt = 1; attempt <= PROPERTY_LIMITS.fieldsMax; attempt++) {
    const candidate = attempt === 1 ? base : `prop${base.charAt(0).toUpperCase()}${base.slice(1)}${attempt === 2 ? '' : String(attempt)}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  assert(false, 'A free local name is found within the field bound');
  return base;
}

function bindingLocal(name: string): string {
  const camel = name.replace(/[^A-Za-z0-9_$]+(.)?/g, (_match: string, next: string | undefined) => (next === undefined ? '' : next.toUpperCase()));
  return /^[A-Za-z_$]/.test(camel) && !RESERVED_WORDS.has(camel) ? camel : `prop${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

function reorderDefinitions(definitions: Definitions, names: readonly string[]): Result<string> {
  const fields = readComponentProperties(definitions.document.source).properties;
  if (new Set(names).size !== names.length || names.length !== fields.length || names.some((name) => !fields.some((field) => field.name === name))) {
    return err(refusal('order', 'props.edit.reorder'));
  }
  const indent = indentUnitOf(definitions.document.frontmatter);
  const chunks = new Map(fields.map((field) => [field.name, withIndentUnit(renderDefinition(field), indent)]));
  const listed = new Set<string>();
  for (const member of definitions.members) {
    const name = propertyKey(member.name);
    assert(name !== undefined, 'Editable property has a name');
    chunks.set(name, terminated(definitions.document.frontmatter.slice(member.getFullStart(), member.end)));
    listed.add(name);
  }
  const container = definitions.container;
  const order = definitions.advanced ? names.filter((name) => listed.has(name)) : names;
  const foreign = container?.members.some((member) => !ts.isPropertySignature(member)) ?? false;
  if (definitions.advanced && (container === undefined || order.length < 2 || foreign)) {
    return ok(definitions.document.source);
  }
  const text = order
    .map((name) => {
      const chunk = chunks.get(name);
      assert(chunk !== undefined, 'Every reordered property has source');
      return chunk;
    })
    .join('');
  if (!container) {
    return ok(replaceFrontmatter(definitions.document, `${newPropsInterface(definitions, text)}${definitions.document.frontmatter}`));
  }
  const first = definitions.members[0];
  const last = definitions.members.at(-1);
  return ok(
    replaceFrontmatter(
      definitions.document,
      applySourceEdits(definitions.document.frontmatter, [
        {
          start: first?.getFullStart() ?? container.end - 1,
          end: last?.end ?? container.end - 1,
          text,
        },
      ]),
    ),
  );
}

export interface PropertyDeclarationRemoval {
  readonly source: string;
  readonly kept: PropertyKeptConstant | undefined;
  readonly blocked: readonly number[];
}

export function removePropertyDeclarations(source: string, name: string): Result<PropertyDeclarationRemoval> {
  const definitions = readDefinitions(source);
  return removedDeclarations(definitions.advanced ? commonDefinitions(definitions, name) : definitions, name);
}

function removeDefinition(definitions: Definitions, name: string): Result<string> {
  const removed = removedDeclarations(definitions, name);
  if (!removed.ok) {
    return removed;
  }
  if (removed.value.blocked.length > 0) {
    return err(refusal('in-use', 'props.edit.readsInCode', { name, lines: removed.value.blocked.join(', ') }));
  }
  return ok(removed.value.source);
}

function removedDeclarations(definitions: Definitions, name: string): Result<PropertyDeclarationRemoval> {
  const member = definitions.members.find((item) => propertyKey(item.name) === name);
  const binding = definitions.bindings.find((item) => propertyKey(item.propertyName ?? item.name) === name);
  const rests = definitions.patterns.flatMap((pattern) => pattern.elements).filter((element) => element.dotDotDotToken !== undefined);
  const holders = new Set([...plainAliases(definitions.document.syntax), ...rests.map((element) => element.name.getText())]);
  const edits: SourceEdit[] = [member, ...definitions.others].flatMap((declared) =>
    declared ? [{ start: declared.getFullStart(), end: declared.end, text: '' }] : [],
  );
  if (binding) {
    const pattern = definitions.patterns.find((item) => item.elements.includes(binding));
    assert(pattern !== undefined, 'A prop binding belongs to an Astro.props pattern');
    const index = pattern.elements.indexOf(binding);
    const next = pattern.elements[index + 1];
    const previous = pattern.elements[index - 1];
    edits.push({
      start: next ? binding.getStart() : (previous?.end ?? binding.getStart()),
      end: next?.getStart() ?? binding.end,
      text: '',
    });
  }
  const document = definitions.document;
  assert(edits.length === 0 || document.start > 0, 'Declarations to take out live in a frontmatter');
  const removed = edits.map((edit) => ({ start: document.start + edit.start, end: document.start + edit.end, text: '' }));
  const origin = { source: document.source, removed };
  const taken = edits.length === 0 ? document.source : replaceFrontmatter(document, applySourceEdits(document.frontmatter, edits));
  const through = propertyReadLines(taken, { local: undefined, name, holders }, origin);
  if (!through.ok) {
    return through;
  }
  const local = binding === undefined ? ok([]) : propertyReadLines(taken, { local: binding.name.getText(), name: undefined, holders: new Set() }, origin);
  if (!local.ok) {
    return local;
  }
  if (binding === undefined || local.value.length === 0) {
    return ok({ source: taken, kept: undefined, blocked: through.value });
  }
  const property = readComponentProperties(document.source).properties.find((candidate) => candidate.name === name);
  const declaredHere = member !== undefined || definitions.others.length > 0;
  const kept = declaredHere ? keptConstant(binding, property, local.value) : undefined;
  if (kept === undefined) {
    return ok({ source: taken, kept: undefined, blocked: [...new Set([...through.value, ...local.value])].sort((first, second) => first - second) });
  }
  const statement = binding.parent.parent;
  assert(ts.isVariableDeclaration(statement), 'A prop binding belongs to a variable declaration');
  const after = statement.parent.parent;
  assert(ts.isVariableStatement(after), 'A props destructure is a variable statement');
  const constant = { start: after.end, end: after.end, text: `\nconst ${binding.name.getText()} = ${kept.code};` };
  const source = replaceFrontmatter(document, applySourceEdits(document.frontmatter, [...edits, constant]));
  return ok({ source, kept: kept.shown, blocked: through.value });
}

interface KeptCode {
  readonly code: string;
  readonly shown: PropertyKeptConstant;
}

function keptConstant(binding: ts.BindingElement, property: ComponentProperty | undefined, lines: readonly number[]): KeptCode | undefined {
  assert(lines.length > 0, 'A constant is kept only for code that reads the prop');
  const type = property === undefined || ['', 'unknown', 'any'].includes(property.type.trim()) ? undefined : property.type;
  const value = keptValue(binding, property, type);
  if (value === undefined) {
    return undefined;
  }
  const typed = value.source === 'undefined' && type !== undefined && !/\bundefined\b/.test(type) ? `${type} | undefined` : type;
  const code = typed === undefined ? value.code : `${castable(value.code)} as ${typed}`;
  return { code, shown: { value: value.code, source: value.source, lines } };
}

function keptValue(
  binding: ts.BindingElement,
  property: ComponentProperty | undefined,
  type: string | undefined,
): { readonly code: string; readonly source: PropertyKeptSource } | undefined {
  const initializer = binding.initializer;
  if (initializer !== undefined) {
    const local = binding.name.getText();
    const selfRead = syntaxNodes(initializer).some((node) => ts.isIdentifier(node) && node.text === local);
    return selfRead ? undefined : { code: initializer.getText(), source: 'default' };
  }
  if (property === undefined || !property.required) {
    return { code: 'undefined', source: 'undefined' };
  }
  const zero = type === undefined ? undefined : zeroValue(type);
  return zero === undefined ? undefined : { code: zero, source: 'zero' };
}

function zeroValue(type: string): string | undefined {
  const first = literalOptions(type)?.[0];
  if (first !== undefined) {
    return first;
  }
  const trimmed = type.trim();
  const zeros: Readonly<Record<string, string>> = { string: '""', number: '0', boolean: 'false' };
  const zero = zeros[trimmed];
  if (zero !== undefined) {
    return zero;
  }
  return /\[\]$|^(readonly\s+)?(Readonly)?Array</.test(trimmed) ? '[]' : undefined;
}

function castable(code: string): string {
  const syntax = ts.createSourceFile('kept.ts', `(${code});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = syntax.statements[0];
  const expression =
    statement !== undefined && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression)
      ? statement.expression.expression
      : undefined;
  const simple =
    expression !== undefined &&
    (ts.isLiteralExpression(expression) ||
      ts.isIdentifier(expression) ||
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression) ||
      ts.isCallExpression(expression) ||
      ts.isArrayLiteralExpression(expression) ||
      ts.isObjectLiteralExpression(expression) ||
      ts.isParenthesizedExpression(expression) ||
      expression.kind === ts.SyntaxKind.TrueKeyword ||
      expression.kind === ts.SyntaxKind.FalseKeyword ||
      expression.kind === ts.SyntaxKind.NullKeyword);
  return simple ? code : `(${code})`;
}
