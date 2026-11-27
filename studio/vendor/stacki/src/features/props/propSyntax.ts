
import { javascript } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';
import type { AttributeLanguage } from '../../ui/attributeLanguage';
import { attributeSyntax } from '../../ui/attributeSyntax';
import { styleDeclarations } from './StyleEditor';

export function propSyntax(language: AttributeLanguage): Extension {
  switch (language) {
    case 'declarations':
      return styleDeclarations;
    case 'javascript':
      return javascript();
    case 'json':
    case 'keyValues':
    case 'mediaQuery':
    case 'pathData':
    case 'regex':
    case 'sourceSet':
    case 'svgNumbers':
    case 'tokens':
      return attributeSyntax(language);
    default: {
      const exhaustive: never = language;
      return exhaustive;
    }
  }
}
