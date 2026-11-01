import { expect, test } from "@playwright/test";
import {
  ANNOUNCE_DELAY_MS,
  holdRounds,
  openPage,
  pauseClock,
  submit,
} from "./page.ts";

test("an equal text is announced again", async ({ page }) => {
  await page.clock.install();
  const routes = await holdRounds(page);
  await openPage(page);
  await pauseClock(page);
  await page.evaluate(() => {
    const region = document
      .querySelector("dicta-action")!
      .shadowRoot!.querySelector('[role="status"]')!;
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    // Every value the region takes, empty ones too.
    new MutationObserver(() => {
      seen.push(region.textContent ?? "");
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  const seen = () =>
    page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  const notice = page.locator('[part~="notice"]');
  const stop = { requestId: "r1", reply: { type: "stop", text: "No." } };
  await submit(page, "a");
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({ json: stop });
  await expect(notice).toHaveCount(1);
  // Working and the stop come within the delay, so both are set together.
  await page.clock.runFor(ANNOUNCE_DELAY_MS);
  await expect.poll(seen).toEqual(["Working\nNo."]);
  await submit(page, "b");
  await expect(notice).toHaveCount(0);
  await expect.poll(() => routes.length).toBe(2);
  await routes[1].fulfill({ json: stop });
  await expect(notice).toHaveCount(1);
  await page.clock.runFor(ANNOUNCE_DELAY_MS);
  // Cleared before the equal text, so screen readers notice the change.
  await expect.poll(seen).toEqual(["Working\nNo.", "", "Working\nNo."]);
});
