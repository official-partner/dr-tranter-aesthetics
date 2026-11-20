/* A formatted text from OP System's Contenu (its kind « Formatted text »: Markdown in the item's file) as the small
   inline HTML a heading or a lead takes: *words* or _words_ in <em> (the system's lighter cut inside a title),
   **words** in <strong>, a line break kept; paragraphs joined, since such a text is one block on the page. Anything
   else stays as written, escaped. The same reading as the app's own (op-system, content-panel.js, mdToHtml). */
export function inlineRich(md: string | undefined): string {
  const text = String(md ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .split(/\n{2,}/)
    .map((block) =>
      esc(block)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
        .replace(/(^|[^\w_])_([^_]+)_(?!\w)/g, "$1<em>$2</em>")
        .replace(/ {2,}\n|\\\n/g, "<br />")
        .replace(/\n/g, " "),
    )
    .join(" ");
}
