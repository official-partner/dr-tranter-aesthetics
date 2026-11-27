
import { splitTopLevelCommas } from './background';
import { rawLayer, splitFunctionList, type RawLayer } from './rawLayer';
import { assert } from '../../../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../../../shared/properties/i18n/messageRef';

export type TransformType = 'move' | 'scale' | 'rotate' | 'skew';
export type Transform = { type: TransformType; x: string; y: string; z: string };
export type TransformLayer = Transform | RawLayer;
export type TransformPatch = Transform | Pick<Transform, 'x'> | Pick<Transform, 'y'> | Pick<Transform, 'z'> | Pick<Transform, 'x' | 'y'>;

export const IDENTITY: Record<TransformType, string> = {
  move: '0rem',
  scale: '1',
  rotate: '0deg',
  skew: '0deg',
};
export const TRANSFORM_TYPE_LABEL_KEY: Record<TransformType, MessageKey> = {
  move: 'styleModel.transform.type.move',
  scale: 'styleModel.transform.type.scale',
  rotate: 'styleModel.transform.type.rotate',
  skew: 'styleModel.transform.type.skew',
};

export const hasZ = (type: TransformType): boolean => type !== 'skew';

const cleanAxis = (text: string): string => text.replace(/^(-?\d*\.?\d+)\s*none$/i, '$1');

const functionName = (call: string): string => call.slice(0, call.indexOf('(')).trim().toLowerCase();
const functionArguments = (call: string): string[] => {
  const open = call.indexOf('(');
  const close = call.lastIndexOf(')');
  if (open < 0 || close <= open) {
    return [];
  }
  return splitTopLevelCommas(call.slice(open + 1, close))
    .map((argument) => cleanAxis(argument.trim()))
    .filter(Boolean);
};

export function parseTransforms(value: string): TransformLayer[] {
  const calls = splitFunctionList(value);
  const out: TransformLayer[] = [];
  let i = 0;
  while (i < calls.length) {
    const call = calls[i];
    assert(call !== undefined, 'parseTransforms: index within calls');
    const kind = editableKind(call);
    if (kind === undefined) {
      out.push(rawLayer(call));
      i += 1;
    } else if (kind === 'rotate') {
      const run = rotateRun(calls, i);
      assert(run.next > i, 'parseTransforms: a rotate run consumes its first call');
      out.push(run.transform);
      i = run.next;
    } else {
      const layerOf = kind === 'move' ? translateLayer : kind === 'scale' ? scaleLayer : skewLayer;
      out.push(layerOf(functionName(call), functionArguments(call)));
      i += 1;
    }
  }
  assert(out.length <= calls.length, 'parseTransforms: at most one layer per function');
  return out;
}

const EDITABLE_FUNCTIONS: ReadonlyMap<string, { readonly type: TransformType; readonly min: number; readonly max: number }> = new Map([
  ['translate', { type: 'move', min: 1, max: 2 }],
  ['translatex', { type: 'move', min: 1, max: 1 }],
  ['translatey', { type: 'move', min: 1, max: 1 }],
  ['translatez', { type: 'move', min: 1, max: 1 }],
  ['translate3d', { type: 'move', min: 3, max: 3 }],
  ['scale', { type: 'scale', min: 1, max: 2 }],
  ['scalex', { type: 'scale', min: 1, max: 1 }],
  ['scaley', { type: 'scale', min: 1, max: 1 }],
  ['scalez', { type: 'scale', min: 1, max: 1 }],
  ['scale3d', { type: 'scale', min: 3, max: 3 }],
  ['rotate', { type: 'rotate', min: 1, max: 1 }],
  ['rotatex', { type: 'rotate', min: 1, max: 1 }],
  ['rotatey', { type: 'rotate', min: 1, max: 1 }],
  ['rotatez', { type: 'rotate', min: 1, max: 1 }],
  ['skew', { type: 'skew', min: 1, max: 2 }],
  ['skewx', { type: 'skew', min: 1, max: 1 }],
  ['skewy', { type: 'skew', min: 1, max: 1 }],
]);

function editableKind(call: string): TransformType | undefined {
  const known = call.includes('(') && call.endsWith(')') ? EDITABLE_FUNCTIONS.get(functionName(call)) : undefined;
  if (known === undefined) {
    return undefined;
  }
  const count = functionArguments(call).length;
  return count >= known.min && count <= known.max ? known.type : undefined;
}

function translateLayer(name: string, args: readonly string[]): Transform {
  const transform: Transform = { type: 'move', x: '0px', y: '0px', z: '0px' };
  if (name === 'translatex') {
    transform.x = args[0] ?? '0px';
  } else if (name === 'translatey') {
    transform.y = args[0] ?? '0px';
  } else if (name === 'translatez') {
    transform.z = args[0] ?? '0px';
  } else if (name === 'translate3d') {
    transform.x = args[0] ?? '0px';
    transform.y = args[1] ?? '0px';
    transform.z = args[2] ?? '0px';
  } else {
    transform.x = args[0] ?? '0px';
    transform.y = args[1] ?? '0px';
  }
  return transform;
}

function scaleLayer(name: string, args: readonly string[]): Transform {
  const transform: Transform = { type: 'scale', x: '1', y: '1', z: '1' };
  if (name === 'scalex') {
    transform.x = args[0] ?? '1';
  } else if (name === 'scaley') {
    transform.y = args[0] ?? '1';
  } else if (name === 'scalez') {
    transform.z = args[0] ?? '1';
  } else if (name === 'scale3d') {
    transform.x = args[0] ?? '1';
    transform.y = args[1] ?? '1';
    transform.z = args[2] ?? '1';
  } else {
    transform.x = args[0] ?? '1';
    transform.y = args[1] ?? args[0] ?? '1';
  }
  return transform;
}

const ROTATE_AXES: ReadonlyMap<string, { readonly axis: 'x' | 'y' | 'z'; readonly order: number }> = new Map([
  ['rotatex', { axis: 'x', order: 0 }],
  ['rotatey', { axis: 'y', order: 1 }],
  ['rotatez', { axis: 'z', order: 2 }],
  ['rotate', { axis: 'z', order: 2 }],
]);

function rotateRun(calls: readonly string[], start: number): { readonly transform: Transform; readonly next: number } {
  const transform: Transform = { type: 'rotate', x: '0deg', y: '0deg', z: '0deg' };
  let order = -1;
  let i = start;
  while (i < calls.length) {
    const call = calls[i] ?? '';
    const turn = editableKind(call) === 'rotate' ? ROTATE_AXES.get(functionName(call)) : undefined;
    if (turn === undefined || turn.order <= order) {
      break;
    }
    transform[turn.axis] = functionArguments(call)[0] ?? '0deg';
    order = turn.order;
    i += 1;
  }
  return { transform, next: i };
}

function skewLayer(name: string, args: readonly string[]): Transform {
  const transform: Transform = { type: 'skew', x: '0deg', y: '0deg', z: '0deg' };
  if (name === 'skewx') {
    transform.x = args[0] ?? '0deg';
  } else if (name === 'skewy') {
    transform.y = args[0] ?? '0deg';
  } else {
    transform.x = args[0] ?? '0deg';
    transform.y = args[1] ?? '0deg';
  }
  return transform;
}

const axis = (value: string, type: TransformType): string => value.trim() || IDENTITY[type];

function serializeOne(transform: Transform): string {
  const x = axis(transform.x, transform.type);
  const y = axis(transform.y, transform.type);
  const z = axis(transform.z, transform.type);
  switch (transform.type) {
    case 'move':
      return `translate3d(${x}, ${y}, ${z})`;
    case 'scale':
      return `scale3d(${x}, ${y}, ${z})`;
    case 'rotate':
      return `rotateX(${x}) rotateY(${y}) rotateZ(${z})`;
    case 'skew':
      return `skew(${x}, ${y})`;
  }
}

export function serializeTransforms(list: readonly TransformLayer[]): string {
  return list
    .map((layer) => (layer.type === 'raw' ? layer.text : serializeOne(layer)))
    .filter(Boolean)
    .join(' ');
}

export function blankTransform(type: TransformType = 'move'): Transform {
  const id = IDENTITY[type];
  return { type, x: id, y: id, z: id };
}

export function retypeTransform(type: TransformType): Transform {
  return blankTransform(type);
}

export function transformLabel(transform: Transform, translate: Translator = ENGLISH_TRANSLATE): string {
  const axes = hasZ(transform.type) ? [transform.x, transform.y, transform.z] : [transform.x, transform.y];
  const shown = axes.map((axis) => axis.trim() || IDENTITY[transform.type]);
  return `${translate(TRANSFORM_TYPE_LABEL_KEY[transform.type])}: ${shown.join(', ')}`;
}
