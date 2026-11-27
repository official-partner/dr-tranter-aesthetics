
import { assert } from '../../shared/core/assert';
import type { ImportDecl } from '../../shared/page/pageNode';
import { renamedFrontmatter, type VariableRename } from '../../shared/engine/variableRename';
import { renamedLoopVar } from './loopBindings';
import type { EditorModel } from './pageView';

export function predictedRename(model: EditorModel, rename: VariableRename): EditorModel {
  assert(rename.from !== rename.to, 'A rename changes the name');
  const imports = model.imports.map((entry) => renamedImport(entry, rename));
  assert(imports.length === model.imports.length, 'A rename keeps every import');
  return {
    ...model,
    imports,
    extraFrontmatter: renamedFrontmatter(model.extraFrontmatter, rename),
    nodes: renamedLoopVar(model.nodes, rename.from, rename.to),
  };
}

function renamedImport(entry: ImportDecl, rename: VariableRename): ImportDecl {
  if (entry.name !== rename.from) {
    return entry;
  }
  return entry.named === true ? { ...entry, name: rename.to, imported: entry.imported ?? rename.from } : { ...entry, name: rename.to };
}
