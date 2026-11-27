
import { assert } from '../../shared/core/assert';
import { REMOTE_SCHEMA_LIMITS, type RemoteRule } from '../../shared/properties/cmsRemoteSchema';

const CALL = /\.(required|min|max|length|email|uri|unique|integer|positive)\(([^()]*)\)/g;

export function rulesOf(source: string | undefined): RemoteRule[] {
  if (source === undefined) {
    return [];
  }
  const level = /\.warning\(/.test(source) && !/\.error\(/.test(source) ? 'warning' : 'error';
  const rules: RemoteRule[] = [];
  for (const match of source.matchAll(CALL)) {
    const rule = ruleOf(match[1] ?? '', match[2] ?? '', level);
    if (rule !== undefined && rules.length < REMOTE_SCHEMA_LIMITS.rulesMax) {
      rules.push(rule);
    }
  }
  assert(rules.length <= REMOTE_SCHEMA_LIMITS.rulesMax, 'A field states few rules');
  return rules;
}

function ruleOf(name: string, args: string, level: RemoteRule['level']): RemoteRule | undefined {
  switch (name) {
    case 'required':
    case 'email':
    case 'unique':
    case 'integer':
    case 'positive':
      return { level, kind: name };
    case 'min':
    case 'max':
    case 'length': {
      const limit = /^\s*(-?\d+(?:\.\d+)?)\s*$/.exec(args)?.[1];
      return limit === undefined ? undefined : { level, kind: name, limit: Number(limit) };
    }
    case 'uri': {
      const schemes = /scheme\s*:\s*\[([^\]]*)\]/.exec(args)?.[1];
      const named = [...(schemes ?? '').matchAll(/["'`]([a-z][a-z0-9+.-]{0,31})["'`]/g)].map((scheme) => scheme[1] ?? '');
      return {
        level,
        kind: 'uri',
        schemes: named.length > 0 ? named : ['http', 'https'],
        relative: /allowRelative\s*:\s*true/.test(args),
      };
    }
    default:
      return undefined;
  }
}
