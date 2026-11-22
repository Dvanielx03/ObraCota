import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Samples the waiting screen every 100 ms until the model is shown: which animation is on screen,
// and whether it is a playing video, a paused one or a picture (with its breathing state).
async function watchWait(page: Page) {
  await page.evaluate(() => {
    const log: string[] = [], arts: string[] = [];
    Object.assign(window, { __wait: log, __arts: arts });
    const tick = () => {
      const art = document.querySelector<HTMLElement>(".loader-art");
      if (art) {
        arts.push(art.dataset.art ?? "");
        const video = art.querySelector("video"), picture = art.querySelector("img");
        log.push(video ? (video.paused ? "paused" : "video:" + video.currentTime.toFixed(2)) : picture ? "picture:" + (art.dataset.still ?? "") : "?");
      }
      if (!document.querySelector(".view[data-ready]")) setTimeout(tick, 100);
    };
    tick();
  });
}

for (const motion of ["no-preference", "reduce"] as const) test.describe(motion, () => {
 test.use({ reducedMotion: motion, viewport: { width: 1366, height: 768 } });
 test("La espera al abrir un proyecto guardado siempre está animada · " + motion, async ({ page }) => {
  const file = process.env.DUPLEX_IFC;
  test.skip(!file, "Indica DUPLEX_IFC");
  test.setTimeout(180_000);
  const auth = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  const headers = { Authorization: "Bearer " + (await auth.json()).accessToken };
  const id = (await (await page.request.post("/api/projects", { headers, data: { name: "Espera animada" } })).json()).id;
  try {
    const upload = await page.request.post("/api/projects/" + id + "/uploads", { params: { name: basename(file!) }, headers: { ...headers, "Content-Type": "application/octet-stream" }, data: readFileSync(file!) });
    expect(upload.ok()).toBeTruthy();
    // The first animation arrives late, so its play() is still pending when the step changes: that
    // interrupted play once froze the whole wait on a picture.
    await page.route("**/loaders/entrada.webm", async route => { await new Promise(done => setTimeout(done, 1500)); await route.continue(); });
    await page.goto("/proyectos/" + id);
    await page.waitForLoadState("networkidle");
    await watchWait(page);
    // From the panel to the viewer: the download, the reading of the file and the minimum hold of 5 s.
    await page.getByRole("link", { name: /^Visor/ }).first().click();
    await page.locator(".view[data-ready]").waitFor({ timeout: 150_000 });
    const { samples, arts } = await page.evaluate(() => {
      const probe = window as unknown as { __wait: string[]; __arts: string[] };
      return { samples: probe.__wait, arts: probe.__arts };
    });
    expect(samples.length).toBeGreaterThan(20);
    if (motion === "no-preference") {
      // The video keeps playing across the change of step (download → reading → settling): no frozen picture.
      expect(samples.filter(s => s.startsWith("picture"))).toEqual([]);
      const playing = samples.filter(s => s.startsWith("video:")).map(s => Number(s.slice(6)));
      expect(new Set(playing).size).toBeGreaterThan(10);
      // One animation for the whole way in, never another drawing halfway through.
      expect(new Set(arts)).toEqual(new Set(["viewer"]));
    } else {
      // With reduced motion the picture stands in for the video and breathes with opacity only.
      expect(samples.filter(s => s.startsWith("video"))).toEqual([]);
      expect(samples.every(s => s === "picture:breathe")).toBe(true);
    }
  } finally {
    await page.request.delete("/api/projects/" + id, { headers });
  }
 });
});
