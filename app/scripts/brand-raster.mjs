// Rasterises the ObraCota symbol and measures the contrast of its accent (roadmap R5).
//
//   node scripts/brand-raster.mjs [output folder]
//
// - src/app/apple-icon.png: 180 px, symbol on white (iOS does not keep transparency).
// - In the output folder (default ../docs/direccion-creativa/logos/verificacion): the favicon
//   (src/app/icon.svg, 16 grid) at 16, 32 and 48 px and the in-app symbol (shared/ui/brand-mark.tsx,
//   24 grid) at 24 and 48 px, on the light and dark page colours, plus hoja.png with every sample enlarged 8× without smoothing.
// - Contrast of --brand-mark against --bg and --surface in both themes, read from src/app/theme.css.
//   Exits with code 1 when any pair is under 3:1 (WCAG 1.4.11, graphical objects).
//
// Uses the Playwright already in devDependencies with the installed Microsoft Edge; nothing is downloaded.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(app, "..", "docs", "direccion-creativa", "logos", "verificacion"));
mkdirSync(out, { recursive: true });

// ---- Contrast -------------------------------------------------------------------------------
const theme = readFileSync(join(app, "src", "app", "theme.css"), "utf8");
function block(selector) {
  const start = theme.indexOf(selector + " {");
  if (start < 0) throw new Error("theme.css: falta " + selector);
  return theme.slice(start, theme.indexOf("\n}", start));
}
function token(css, name) {
  const match = css.match(new RegExp("--" + name + ":\\s*(#[0-9A-Fa-f]{6})"));
  if (!match) throw new Error("theme.css: falta --" + name);
  return match[1];
}
const channel = value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const modes = {
  claro: block(":root"),
  oscuro: block(':root[data-theme="dark"]'),
};
const palette = Object.fromEntries(Object.entries(modes).map(([mode, css]) =>
  [mode, { mark: token(css, "brand-mark"), ink: token(css, "ink"), bg: token(css, "bg"), surface: token(css, "surface") }]));
let failed = false;
for (const [mode, colours] of Object.entries(palette))
  for (const ground of ["bg", "surface"]) {
    const ratio = contrast(colours.mark, colours[ground]);
    if (ratio < 3) failed = true;
    console.log(`${ratio >= 3 ? "ok " : "BAJO"} ${mode.padEnd(6)} --brand-mark ${colours.mark} sobre --${ground.padEnd(7)} ${colours[ground]}: ${ratio.toFixed(2)}:1`);
  }
// The system-dark block repeats the explicit dark one; a drift between them would show only for some viewers.
const system = theme.slice(theme.indexOf("@media (prefers-color-scheme: dark)"));
if (token(system, "brand-mark") !== palette.oscuro.mark) { failed = true; console.log("BAJO el bloque «Sistema» oscuro no repite --brand-mark"); }

// ---- Rasters --------------------------------------------------------------------------------
const favicon = readFileSync(join(app, "src", "app", "icon.svg"), "utf8");
const brand = readFileSync(join(app, "src", "shared", "ui", "brand-mark.tsx"), "utf8");
const path = name => brand.match(new RegExp(name + ': "([^"]+)"'))[1];
const symbol = (colours) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">`
  + `<path fill="${colours.ink}" d="${path("top")}"/><path fill="${colours.mark}" d="${path("level")}"/><path fill="${colours.ink}" d="${path("base")}"/></svg>`;

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();

/** Renders `svg` into a size × size box painted `ground` and returns the PNG. */
async function render(svg, size, ground, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: Math.max(size, 64), height: Math.max(size, 64) });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:${ground}}#box{width:${size}px;height:${size}px}#box svg{display:block;width:100%;height:100%}</style><div id="box">${svg}</div>`);
  return page.locator("#box").screenshot({ omitBackground: ground === "transparent" });
}

const samples = [];
for (const [mode, colours] of Object.entries(palette)) {
  const scheme = mode === "claro" ? "light" : "dark";
  // The favicon at the sizes a tab and a bookmark use; the 24-grid symbol at the size the app draws it
  // (24, whole pixels) and at 2×.
  for (const [kind, svg, sizes] of [["favicon", favicon, [16, 32, 48]], ["isotipo", symbol(colours), [24, 48]]]) {
    for (const size of sizes) {
      const file = `${kind}-${size}-${mode}.png`;
      const png = await render(svg, size, colours.bg, scheme);
      writeFileSync(join(out, file), png);
      samples.push({ file, kind, size, mode, ground: colours.bg, png });
    }
  }
}
writeFileSync(join(app, "src", "app", "apple-icon.png"), await render(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#FFFFFF"/>${symbol(palette.claro).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>`,
  180, "#FFFFFF", "light"));

// Contact sheet: each sample at its real size and enlarged 8× with hard pixels.
const cell = sample => `<figure style="background:${sample.ground}"><img src="data:image/png;base64,${sample.png.toString("base64")}" width="${sample.size}" height="${sample.size}">`
  + `<img class="zoom" src="data:image/png;base64,${sample.png.toString("base64")}" width="${sample.size * 8}" height="${sample.size * 8}">`
  + `<figcaption style="color:${sample.mode === "claro" ? "#646A78" : "#A8AFBD"}">${sample.file}</figcaption></figure>`;
await page.emulateMedia({ colorScheme: "light" });
await page.setViewportSize({ width: 1400, height: 800 });
await page.setContent(`<!doctype html><style>body{margin:0;padding:24px;background:#FFFFFF;font:12px "Segoe UI",system-ui,sans-serif;color:#171E2B}
  h1{font-size:16px;margin:0 0 4px}p{margin:0 0 16px;color:#646A78}.row{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap}
  figure{margin:0;padding:12px;border-radius:8px;display:grid;gap:8px;justify-items:start}.zoom{image-rendering:pixelated}</style>
  <h1>ObraCota · isotipo «Cota de nivel» a tamaño real y ampliado 8×</h1>
  <p>favicon = app/src/app/icon.svg (retícula 16) · isotipo = BrandMark (retícula 24). Fondo: --bg de cada tema.</p>
  ${["claro", "oscuro"].map(mode => `<div class="row">${samples.filter(s => s.mode === mode).map(cell).join("")}</div>`).join("")}`);
await page.screenshot({ path: join(out, "hoja.png"), fullPage: true });
await browser.close();

console.log(`PNG escritos en ${out} (${samples.length} muestras + hoja.png) y src/app/apple-icon.png`);
if (failed) { console.error("Contraste del acento por debajo de 3:1"); process.exit(1); }
