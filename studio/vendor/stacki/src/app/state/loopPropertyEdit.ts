
import type { Translator } from '../../lib/i18n/localeContext';
import { editComponentProperties, readComponentProperties } from '../../features/componentProperties/propertiesBridge';
import { propertyName } from '../../../shared/properties/propertyEditing';
import { assert } from '../../../shared/core/assert';
import type { PropertySaver } from '../../features/componentProperties/propertySave';
import { propertyErrorTextFor } from '../../lib/i18n/propertyErrorText';

export interface LoopPropertyEdit {
  readonly name: string;
  readonly description: string;
}

export type LoopPropertySaver = PropertySaver;

export async function editLoopProperty(saver: LoopPropertySaver, key: string, edit: LoopPropertyEdit, translate: Translator): Promise<string | undefined> {
  assert(key !== '', 'A property is named');
  try {
    propertyName(edit.name);
  } catch (caught: unknown) {
    return caught instanceof Error ? caught.message : String(caught);
  }
  saver.changePhase('saving');
  try {
    await saver.flushSave();
    const read = await readComponentProperties(saver.projectPath, saver.file);
    if (!read.ok) {
      return propertyErrorTextFor(read.error, translate);
    }
    const property = read.value.properties.find((candidate) => candidate.name === key);
    if (property === undefined) {
      return translate('shell.loop.propertyGone', { name: key });
    }
    const change = { kind: 'save' as const, originalName: key, property: { ...property, name: edit.name, description: edit.description } };
    const result = await editComponentProperties(saver.projectPath, saver.file, read.value.source, change);
    if (!result.ok) {
      return propertyErrorTextFor(result.error, translate);
    }
    saver.recordUndo(result.value.undo);
    await saver.completeSave();
    return undefined;
  } finally {
    saver.changePhase('idle');
  }
}
