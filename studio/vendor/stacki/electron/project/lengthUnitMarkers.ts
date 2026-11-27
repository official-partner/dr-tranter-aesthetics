
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assert } from '../../shared/core/assert';
import { detectLengthUnit, LENGTH_UNIT_LIMITS, type LengthUnit } from '../../shared/properties/lengthUnit';

export function readLengthUnit(root: string): LengthUnit {
  assert(path.isAbsolute(root), 'readLengthUnit: the project root is absolute');
  const manifest = readBounded(path.join(root, 'package.json'), LENGTH_UNIT_LIMITS.manifestCharsMax);
  const lumosGuide = isPlainFile(path.join(root, 'LUMOS.md'));
  const stylesheets = lumosGuide || manifest !== undefined ? readStylesheets(path.join(root, 'src', 'styles')) : [];
  assert(stylesheets.length <= LENGTH_UNIT_LIMITS.stylesheetsMax, 'readLengthUnit: stylesheet count is bounded');
  return detectLengthUnit({ manifest, lumosGuide, stylesheets });
}

function readStylesheets(directory: string): readonly string[] {
  let names: readonly string[];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  const sheets = names
    .filter((name) => name.endsWith('.css'))
    .sort()
    .slice(0, LENGTH_UNIT_LIMITS.stylesheetsMax);
  return sheets.flatMap((name) => {
    const text = readBounded(path.join(directory, name), LENGTH_UNIT_LIMITS.stylesheetCharsMax);
    return text === undefined ? [] : [text];
  });
}

function readBounded(file: string, charsMax: number): string | undefined {
  if (!isPlainFile(file)) {
    return undefined;
  }
  try {
    if (fs.statSync(file).size > charsMax * 4) {
      return undefined;
    }
    const text = fs.readFileSync(file, 'utf8');
    return text.length > charsMax ? undefined : text;
  } catch {
    return undefined;
  }
}

function isPlainFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}
