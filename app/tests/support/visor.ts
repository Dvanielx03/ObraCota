import { expect, type Page } from "@playwright/test";

/**
 * Hides the interface that floats over the canvas (header, explorer button, saved-view strip, version
 * rail, bottom bars, view cube, notices, hints and the HTML selection marker), so a screenshot of the
 * canvas compares the model render alone. Hover states, the theme icon or the cube turning would
 * otherwise change a capture by themselves.
 */
export const MODEL_ONLY = ".viewer-header,.stagebar,.workspace-bars,.cube-host,.scene-strip,.version-rail,.workspace-toast,.walk-hint,.plan-location-hint,.note-marker{visibility:hidden!important}";

/**
 * Waits until the canvas shows the model. The preparing screen stays at least 5 s after the viewer
 * mounts (`domain/entry-hold.ts`) and the canvas is hidden until then, so a click meanwhile picks
 * nothing. Then the 350 ms reveal of the canvas and the bars' entry animation must end, so captures
 * and measurements read the steady state.
 */
export async function modelShown(page: Page) {
  await expect(page.locator(".stage > .view[data-ready]")).toBeVisible();
  await expect(page.locator(".model-preparing")).toHaveCount(0);
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}
