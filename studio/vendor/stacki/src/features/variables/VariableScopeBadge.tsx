import React from 'react';
import type { WireVariableScope } from '../../../shared/ipc/ipcResults';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { useTranslate } from '../../lib/i18n/useTranslate';

const STYLE_TAG = { tag: '<style>' } as const;


export function variableScopeLabel(scope: WireVariableScope, translate: Translator = ENGLISH_TRANSLATE): string {
  switch (scope.reach) {
    case 'page':
      return translate('variables.scope.page');
    case 'rendered':
      return translate('variables.scope.rendered');
    case 'scoped':
      return translate('variables.scope.scoped');
    default: {
      const exhaustive: never = scope.reach;
      return exhaustive;
    }
  }
}

function reachDetail(reach: WireVariableScope['reach'], translate: Translator): string {
  switch (reach) {
    case 'page':
      return translate('variables.scope.pageDetail', STYLE_TAG);
    case 'rendered':
      return translate('variables.scope.renderedDetail', STYLE_TAG);
    case 'scoped':
      return translate('variables.scope.scopedDetail', STYLE_TAG);
    default: {
      const exhaustive: never = reach;
      return exhaustive;
    }
  }
}

function writtenDetail(written: WireVariableScope['written'], translate: Translator): string {
  switch (written) {
    case 'global':
      return translate('variables.scope.writtenGlobal');
    case 'inline':
      return translate('variables.scope.writtenInline');
    case 'scoped':
      return translate('variables.scope.writtenScoped', STYLE_TAG);
    default: {
      const exhaustive: never = written;
      return exhaustive;
    }
  }
}

export function variableScopeDetail(scope: WireVariableScope, translate: Translator = ENGLISH_TRANSLATE): string {
  return `${reachDetail(scope.reach, translate)} ${writtenDetail(scope.written, translate)}`;
}

export function VariableScopeBadge({ scope }: { readonly scope: WireVariableScope | undefined }) {
  const translate = useTranslate();
  if (scope === undefined) {
    return undefined;
  }
  return (
    <span className="vars-scope" title={variableScopeDetail(scope, translate)}>
      {variableScopeLabel(scope, translate)}
    </span>
  );
}
