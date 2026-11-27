
let editingRoot: HTMLElement | undefined;
let stylesheet: CSSStyleSheet | undefined;

export function isCanvasTextEditing(target: unknown): boolean {
  return target instanceof Node && !!editingRoot?.contains(target);
}

export function holdTextEditing(root: HTMLElement): () => void {
  editingRoot = root;
  return () => {
    if (editingRoot === root) {
      editingRoot = undefined;
    }
  };
}

export function styleTextEditor(whiteSpace: string | undefined): void {
  if (!stylesheet) {
    stylesheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];
  }
  const preserved = whiteSpace === undefined ? '' : ` white-space: ${whiteSpace} !important;`;
  stylesheet.replaceSync(
    `[data-avb-text-editor] { outline: none !important; caret-color: auto !important;${preserved} }` +
      '[data-avb-text-editor][data-avb-text-blocks] { outline: 1px solid #0099ff !important; outline-offset: 3px !important; }' +
      '[data-avb-text-editor][data-avb-text-blocks="rich"] { outline-color: #30c158 !important; }' +
      '[data-avb-text-editor], [data-avb-text-editor] * { cursor: text !important; }',
  );
}
