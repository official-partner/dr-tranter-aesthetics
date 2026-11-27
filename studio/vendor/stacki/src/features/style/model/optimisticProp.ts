
import { assert } from '../../../../shared/core/assert';
import type { Contributor, ResolvedProp } from './resolved';

export function withCommitted(
  resolved: ResolvedProp | undefined,
  edit: { readonly prop: string; readonly value: string; readonly important: boolean; readonly selector: string },
): ResolvedProp {
  assert(edit.prop.length > 0, 'withCommitted: a property is named');
  assert(resolved === undefined || resolved.prop === edit.prop, 'withCommitted: the model is for the edited property');
  const own = resolved?.contributors.find((contributor) => contributor.editing === true) ?? resolved?.contributors.find(isPicked);
  if (resolved === undefined || own === undefined) {
    const added: Contributor = {
      selectorText: edit.selector,
      value: edit.value,
      important: edit.important,
      specificity: [0, 0, 0],
      order: Number.MAX_SAFE_INTEGER,
      ruleId: '',
      origin: resolved?.selectedOrigin ?? 'embed',
      isSelected: true,
      editing: true,
      winning: true,
      complexOnly: false,
    };
    const others = (resolved?.contributors ?? []).map((contributor) => ({ ...contributor, winning: false }));
    return {
      prop: edit.prop,
      source: 'selected',
      selectedOrigin: added.origin,
      selectedValue: { value: edit.value, important: edit.important },
      winner: added,
      overridden: false,
      contributors: [added, ...others],
    };
  }
  const updated: Contributor = { ...own, value: edit.value, important: edit.important };
  const contributors = resolved.contributors.map((contributor) => (contributor === own ? updated : contributor));
  const winner = resolved.winner === own ? updated : resolved.winner;
  assert(contributors.length === resolved.contributors.length, 'withCommitted: an update keeps every contributor');
  return { ...resolved, source: 'selected', selectedOrigin: own.origin, selectedValue: { value: edit.value, important: edit.important }, winner, contributors };
}

export function withCleared(resolved: ResolvedProp | undefined): ResolvedProp | undefined {
  if (resolved === undefined) {
    return undefined;
  }
  const remaining = resolved.contributors.filter((contributor) => !isPicked(contributor));
  assert(remaining.length <= resolved.contributors.length, 'withCleared: a clear only removes');
  const next = remaining[0];
  if (next === undefined) {
    return undefined;
  }
  const winner: Contributor = { ...next, winning: true };
  const contributors = [winner, ...remaining.slice(1).map((contributor) => ({ ...contributor, winning: false }))];
  return { prop: resolved.prop, source: 'other', winner, overridden: false, contributors };
}

function isPicked(contributor: Contributor): boolean {
  if (contributor.editing === true) {
    return true;
  }
  return contributor.isSelected;
}
