
import type { Translator } from '../../lib/i18n/localeContext';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import { assert } from '../../../shared/core/assert';
import { err, ok, type Result } from '../../../shared/core/result';
import { frontmatterGesture } from '../../editor/editGestures';
import type { EditGesture } from '../../editor/pageEdits';
import { namesInScope } from '../../editor/dataSuggest';
import { ATTRIBUTES_TYPE, declaredProp, restReleased, type PropDeclaration, type PropImport } from '../../editor/propDeclaration';
import { restUsedElsewhere } from '../../editor/attributesBinding';
import type { EditorModel } from '../../editor/pageView';

export interface NewPropGesture {
  readonly gesture: EditGesture;
  readonly local: string;
}

export function newPropGesture(model: EditorModel, declaration: PropDeclaration, translate: Translator = ENGLISH_TRANSLATE): Result<NewPropGesture, string> {
  if (model.format !== undefined) {
    return err(translate('shell.prop.astroOnly'));
  }
  const taken = namesInScope(model.extraFrontmatter, model.imports);
  const declared = declaredProp(model.extraFrontmatter, declaration, taken, model.imports, translate);
  if (!declared.ok) {
    return declared;
  }
  const imports = withImports(model.imports, declared.value.imports);
  const { frontmatter, local } = declared.value;
  const gesture = frontmatterGesture(model, { coalesceKey: undefined, urgency: true }, (shown) => ({ ...shown, extraFrontmatter: frontmatter, imports }));
  assert(gesture.coalesceKey === undefined, 'A declared prop is a step of its own');
  return ok({ gesture, local });
}

function withImports(imports: EditorModel['imports'], needed: readonly PropImport[]): EditorModel['imports'] {
  const added = needed
    .filter((wanted) => !imports.some((entry) => entry.name === wanted.name))
    .map((wanted) =>
      wanted.named
        ? { name: wanted.name, imported: wanted.name, path: wanted.path, quote: '"', named: true, typeOnly: wanted.typeOnly }
        : { name: wanted.name, path: wanted.path, quote: '"' },
    );
  const out = [...imports, ...added];
  assert(out.length <= imports.length + needed.length, 'withImports: at most the needed imports are added');
  return out;
}

export function releasedRestGesture(model: EditorModel, local: string, markup: string): EditGesture | undefined {
  if (restUsedElsewhere(markup, local)) {
    return undefined;
  }
  const frontmatter = restReleased(model.extraFrontmatter, local);
  if (frontmatter === undefined) {
    return undefined;
  }
  const named = new RegExp(`\\b${ATTRIBUTES_TYPE.name}\\b`).test(frontmatter);
  const imports = model.imports.filter((entry) => named || entry.name !== ATTRIBUTES_TYPE.name || entry.path !== ATTRIBUTES_TYPE.path);
  assert(imports.length >= model.imports.length - 1, 'releasedRestGesture: at most the one import goes');
  const gesture = frontmatterGesture(model, { coalesceKey: undefined, urgency: true }, (shown) => ({ ...shown, extraFrontmatter: frontmatter, imports }));
  assert(gesture.coalesceKey === undefined, 'A released prop is a step of its own');
  return gesture;
}
