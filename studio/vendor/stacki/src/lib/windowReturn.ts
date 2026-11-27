export function onWindowReturn(reconcile: () => void): () => void {
  const whenVisible = (): void => {
    if (document.visibilityState === 'visible') {
      reconcile();
    }
  };
  window.addEventListener('focus', whenVisible);
  document.addEventListener('visibilitychange', whenVisible);
  return () => {
    window.removeEventListener('focus', whenVisible);
    document.removeEventListener('visibilitychange', whenVisible);
  };
}
