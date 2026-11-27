
type Measurer = { readonly kind: 'unmade' } | { readonly kind: 'made'; readonly context: CanvasRenderingContext2D | undefined };

let measurer: Measurer = { kind: 'unmade' };

function measuringContext(): CanvasRenderingContext2D | undefined {
  if (measurer.kind === 'unmade') {
    const context = document.createElement('canvas').getContext('2d') ?? undefined;
    measurer = { kind: 'made', context };
  }
  return measurer.context;
}

function fontOf(computed: CSSStyleDeclaration): string {
  if (computed.font) {
    return computed.font;
  }
  const size = `${computed.fontSize} / ${computed.lineHeight}`;
  return `${computed.fontStyle} ${computed.fontWeight} ${size} ${computed.fontFamily}`;
}

export function caretAtX(element: HTMLInputElement | HTMLTextAreaElement, clientX: number): number {
  const text = element.value;
  if (!text) {
    return 0;
  }
  const context = measuringContext();
  if (!context) {
    return text.length;
  }

  const computed = window.getComputedStyle(element);
  context.font = fontOf(computed);
  context.letterSpacing = computed.letterSpacing === 'normal' ? '0px' : computed.letterSpacing;

  const rect = element.getBoundingClientRect();
  const padLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const padRight = Number.parseFloat(computed.paddingRight) || 0;
  const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(computed.borderRightWidth) || 0;

  const width = context.measureText(text).width;
  const inner = rect.width - borderLeft - borderRight - padLeft - padRight;
  const wraps = element.tagName === 'TEXTAREA' && (text.includes('\n') || width > inner);
  if (wraps) {
    return element.selectionStart ?? 0;
  }

  let originX = rect.left + borderLeft + padLeft - element.scrollLeft;
  if (width < inner) {
    const align = computed.textAlign;
    if (align === 'center') {
      originX += (inner - width) / 2;
    } else if (align === 'right' || align === 'end') {
      originX += inner - width;
    }
  }

  const x = clientX - originX;
  if (x <= 0) {
    return 0;
  }
  if (x >= width) {
    return text.length;
  }

  let previous = 0;
  for (let i = 1; i <= text.length; i++) {
    const current = context.measureText(text.slice(0, i)).width;
    if (x < (previous + current) / 2) {
      return i - 1;
    }
    previous = current;
  }
  return text.length;
}
