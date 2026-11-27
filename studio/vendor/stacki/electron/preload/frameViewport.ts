
import { PRELOAD_LIMITS } from './frameBasics';
import { freezeViewportValue, parseViewportHeight } from './frameViewportUnits';
import { freezeInlineViewport } from './frameViewportInline';

export const report = () => {
  try {
    const body = document.body;
    let height;
    if (body) {
      const styles = getComputedStyle(body);
      height = body.offsetTop + body.scrollHeight + (parseFloat(styles.marginBottom) || 0);
    } else {
      height = document.documentElement.scrollHeight;
    }
    window.parent.postMessage({ type: 'avb:page-height', height: Math.ceil(height) }, '*');
  } catch {
  }
};

let overrideElement: HTMLStyleElement | undefined = undefined;
let rewriteTimer: ReturnType<typeof setTimeout> | undefined;

const filterRule = (rule: CSSRule, depth: number): string => {
  if (depth > PRELOAD_LIMITS.cssRuleDepthMax) {
    return '';
  }
  if (asImport(rule)) {
    return filterImportRule(rule, depth);
  }
  if (asStyleLike(rule)) {
    return filterStyleRule(rule, depth);
  }
  if (rule instanceof CSSGroupingRule && rule.cssRules.length) {
    const inner = filterRules(rule.cssRules, depth + 1);
    if (!inner) {
      return '';
    }
    const head = rule.cssText.slice(0, rule.cssText.indexOf('{'));
    return head + '{\n' + inner + '}\n';
  }
  return '';
};

const filterRules = (rules: CSSRuleList, depth: number): string => {
  let out = '';
  for (let ri = 0; ri < rules.length; ri++) {
    const child = rules[ri];
    if (child) {
      out += filterRule(child, depth);
    }
  }
  return out;
};

const filterImportRule = (rule: CSSImportRule, depth: number): string => {
  if (!rule.styleSheet) {
    importsPending = true;
    return '';
  }
  let inner = '';
  try {
    inner = filterRules(rule.styleSheet.cssRules, depth + 1);
  } catch {
    return '';
  }
  if (!inner) {
    return '';
  }
  const layer = /\blayer\(([^)]*)\)/i.exec(rule.cssText || '');
  if (!layer) {
    return inner;
  }
  const layerBody = layer[1] ?? '';
  return `@layer ${layerBody.trim()} {\n${inner}}\n`;
};

const filterStyleRule = (rule: CSSStyleRule | CSSKeyframeRule, depth: number): string => {
  let nested = '';
  if (rule instanceof CSSGroupingRule && rule.cssRules.length) {
    nested = filterRules(rule.cssRules, depth + 1);
  }
  let decls = '';
  for (let di = 0; di < rule.style.length; di++) {
    const prop = rule.style.item(di);
    const value = rule.style.getPropertyValue(prop);
    const prio = rule.style.getPropertyPriority(prop);
    const frozenValue = freezeViewportValue(value);
    const hasVh = frozenValue !== value;
    const isFixed = prop === 'position' && /fixed/.test(value);
    if (!hasVh && !isFixed) {
      continue;
    }
    const newValue = isFixed ? 'absolute' : frozenValue;
    decls += `${prop}: ${newValue}${prio ? ' !important' : ''}; `;
  }
  if (!decls && !nested) {
    return '';
  }
  const selector = selectorOf(rule);
  return `${selector} { ${decls}${nested ? '\n' + nested : ''}}\n`;
};

const asImport = (rule: CSSRule): rule is CSSImportRule => rule.type === 3 || ('styleSheet' in rule && !!rule['styleSheet']);
const asStyleLike = (rule: CSSRule): rule is CSSStyleRule | CSSKeyframeRule => {
  if (!('style' in rule) || !rule['style']) {
    return false;
  }
  const selectorText = 'selectorText' in rule ? rule['selectorText'] : undefined;
  const keyText = 'keyText' in rule ? rule['keyText'] : undefined;
  return !!(selectorText || keyText);
};
const selectorOf = (rule: CSSStyleRule | CSSKeyframeRule): string => {
  const selectorText = 'selectorText' in rule ? rule.selectorText : undefined;
  const keyText = 'keyText' in rule ? rule.keyText : undefined;
  return selectorText || keyText || '';
};

let importsPending = false;
let importRetries = 0;
const rewriteSheets = () => {
  if (!document.head) {
    return;
  }
  importsPending = false;
  let css = 'html, body { height: auto !important; }\n';
  const sheets = document.styleSheets;
  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    if (!sheet) {
      continue;
    }
    if (sheet.ownerNode === overrideElement) {
      continue;
    }
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    css += filterRules(rules, 0);
  }
  if (!overrideElement) {
    overrideElement = document.createElement('style');
    overrideElement.id = 'avb-vh-override';
  }
  if (overrideElement.textContent !== css) {
    overrideElement.textContent = css;
  }
  if (document.head.lastElementChild !== overrideElement) {
    document.head.appendChild(overrideElement);
  }
  if (importsPending && importRetries < 25) {
    importRetries += 1;
    setTimeout(rewriteSheets, 120);
  }
};

const scheduleRewrite = () => {
  clearTimeout(rewriteTimer);
  rewriteTimer = setTimeout(() => {
    rewriteSheets();
    report();
  }, 100);
};

let frozen = false;

export const freezeViewportHeight = (value: unknown) => {
  const px = parseViewportHeight(value);
  if (px === undefined) {
    return;
  }
  document.documentElement.style.setProperty('--avb-vh', px / 100 + 'px');
  if (!frozen) {
    frozen = true;
    rewriteSheets();
    freezeInlineViewport(report);
    window.addEventListener('load', scheduleRewrite);
    new MutationObserver(scheduleRewrite).observe(document.head || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  report();
};
