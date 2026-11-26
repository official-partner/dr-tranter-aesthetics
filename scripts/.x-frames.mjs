import { chromium } from "playwright-core";
const [w, h, id, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await b.newContext({ viewport: { width: w, height: h } });
await ctx.addInitScript(() => { try { localStorage.setItem("dta-consent", "denied"); } catch {} });
const p = await ctx.newPage();
await p.goto("http://localhost:4399/team/"); await p.waitForTimeout(2500);
const link = p.locator(`.concern-index_link[href="#${id}"]`);
await link.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -200));
await link.hover(); await p.waitForTimeout(900);
const shoot = async (tag, times) => {
  const anims = await p.evaluate(() => { window.__a = document.getAnimations().filter((a) => a.playState === "running"); window.__a.forEach((a) => a.pause()); return window.__a.length; });
  for (const t of times) {
    await p.evaluate((t) => window.__a.forEach((a) => (a.currentTime = t)), t);
    await p.screenshot({ path: `${out}/${tag}-${String(t).padStart(4, "0")}.png` });
  }
  await p.evaluate(() => window.__a.forEach((a) => a.play()));
  return anims;
};
await link.click();
console.log("open anims", await shoot("o", [0, 150, 300, 450, 600, 800, 1100, 1800]));
await p.waitForTimeout(2000);
await p.click(`#${id} [data-sheet-close]`);
console.log("close anims", await shoot("c", [0, 150, 300, 450, 600, 800, 1100, 1800]));
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/c-after.png` });
await b.close();
