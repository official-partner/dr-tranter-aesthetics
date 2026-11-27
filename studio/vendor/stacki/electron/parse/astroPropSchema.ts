
import type { SchemaField } from './astroParserTypes';
import { readPropModel } from './propModel/readPropModel';
import { schemaFieldsOf } from '../../shared/properties/propModelSchema';

export function parsePropSchema(source: string, prelude = ''): SchemaField[] {
  return schemaFieldsOf(readPropModel(source, prelude));
}
