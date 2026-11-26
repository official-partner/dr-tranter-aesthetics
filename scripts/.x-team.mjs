import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
const root = path.resolve("dist");
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (/^\/(.*googletag|.*facebook)/.test(p)) return res.end("");
  let f = path.join(root, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) f = f + ".html";
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  const ext = path.extname(f);
  res.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2" }[ext] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(4399);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem("dta-consent", "denied"); sessionStorage.setItem("op-loader", "1"); } catch {} });
await ctx.route(/googletagmanager|google-analytics|facebook/, (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:4399/team/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.evaluate(() => (window.__mark = 1));
const link = p.locator('.concern-index_link[href="#sarah-tranter"]');
await link.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -150));
await link.hover(); await p.waitForTimeout(900);
await p.screenshot({ path: "/tmp/tt/o-00.png" });
await p.evaluate(() => { window.__log = []; const m = document.querySelector("#sarah-tranter .team-profile_media"); const h = document.querySelector("#sarah-tranter h2"); const t0 = performance.now(); const f = () => { const r = m.getBoundingClientRect(); window.__log.push([Math.round(performance.now() - t0), Math.round(r.left), Math.round(r.top), Math.round(r.width), getComputedStyle(m).clipPath.slice(0, 30), getComputedStyle(h).opacity, getComputedStyle(document.querySelector("main > :not(dialog) > *")).opacity, document.querySelector("#sarah-tranter").className]); if (performance.now() - t0 < 1500) requestAnimationFrame(f); }; document.addEventListener("click", () => requestAnimationFrame(f), { once: true, capture: true }); });
await link.click();
await p.waitForTimeout(1600);
console.log((await p.evaluate(() => window.__log)).filter((_, i) => i % 6 === 0).map((r) => r.join(" ")).join("\n"));
for (let i = 1; i <= 0; i++) { await p.waitForTimeout(110); await p.screenshot({ path: `/tmp/tt/o-${String(i).padStart(2, "0")}.png` }); }
console.log("url after open", p.url(), await p.evaluate(() => [document.querySelector("dialog#sarah-tranter").open, window.__mark]));
await p.waitForTimeout(1200);
await p.screenshot({ path: "/tmp/tt/o-end.png" });
await p.click("#sarah-tranter [data-sheet-close]");
for (let i = 1; i <= 10; i++) { await p.waitForTimeout(100); await p.screenshot({ path: `/tmp/tt/c-${String(i).padStart(2, "0")}.png` }); }
await p.waitForTimeout(1500);
await p.screenshot({ path: "/tmp/tt/c-end.png" });
console.log("url after close", p.url(), await p.evaluate(() => [document.querySelector("dialog#sarah-tranter").open, window.__mark, document.querySelector("dialog#sarah-tranter").className]));
// browser back
await link.click(); await p.waitForTimeout(1500);
await p.goBack(); await p.waitForTimeout(1500);
console.log("after goBack", p.url(), await p.evaluate(() => [document.querySelector("dialog#sarah-tranter").open, window.__mark]));
await p.goForward(); await p.waitForTimeout(1500);
console.log("after goForward", p.url(), await p.evaluate(() => [document.querySelector("dialog#sarah-tranter").open, window.__mark]));
await p.keyboard.press("Escape"); await p.waitForTimeout(1500);
console.log("after Escape", p.url(), await p.evaluate(() => [document.querySelector("dialog#sarah-tranter").open, window.__mark, [...document.querySelectorAll("main > :not(dialog) > *")].map(e=>getComputedStyle(e).opacity).join(",")]));
// direct
const q = await ctx.newPage();
await q.goto("http://localhost:4399/team/#megan-newman", { waitUntil: "networkidle" });
await q.waitForTimeout(2500);
await q.screenshot({ path: "/tmp/tt/direct.png" });
console.log("direct", await q.evaluate(() => [document.querySelector("dialog#megan-newman").open]));
await q.click("#megan-newman [data-sheet-close]"); await q.waitForTimeout(1500);
console.log("direct closed", q.url(), await q.evaluate(() => document.querySelector("dialog#megan-newman").open));
// phone
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto("http://localhost:4399/team/", { waitUntil: "networkidle" }); await m.waitForTimeout(2000);
await m.locator('.concern-index_link[href="#abbey-lang"]').click();
await m.waitForTimeout(300); await m.screenshot({ path: "/tmp/tt/m-mid.png" });
await m.waitForTimeout(1800); await m.screenshot({ path: "/tmp/tt/m-end.png" });
console.log("errors", errs);
await b.close(); srv.close();
