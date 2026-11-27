import { assert } from '../../../shared/core/assert';
import { appThemeView, parseAppUiTheme, type AppThemeView } from '../../../shared/properties/appUiKit';

export function currentAppTheme(): AppThemeView {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  const view = appThemeView(parseAppUiTheme(root?.dataset['theme']));
  assert(view.theme.length > 0, 'A theme has a name');
  return view;
}

export function createThemeFollower(read: () => AppThemeView, listener: (view: AppThemeView) => void): { readonly check: () => void } {
  let last = read().theme;
  assert(last.length > 0, 'The first theme has a name');
  return {
    check: () => {
      const view = read();
      assert(view.theme.length > 0, 'A theme has a name');
      if (view.theme === last) {
        return;
      }
      last = view.theme;
      listener(view);
    },
  };
}

export function watchAppTheme(listener: (view: AppThemeView) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') {
    return () => undefined;
  }
  const follower = createThemeFollower(currentAppTheme, listener);
  const observer = new MutationObserver(() => follower.check());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
