import { expect, test } from "@playwright/test";
import { openPage, replies, submit } from "./page.ts";

test("an equal text is announced again", async ({ page }) => {
  await replies(
    page,
    { type: "stop", text: "No." },
    { type: "stop", text: "No." },
  );
  await openPage(page);
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
  await submit(page, "a");
  // Working and the stop come within a moment, so both are set together.
  await expect.poll(seen).toEqual(["Working\nNo."]);
  await submit(page, "b");
  // Cleared before the equal text, so screen readers notice the change.
  await expect.poll(seen).toEqual(["Working\nNo.", "", "Working\nNo."]);
});
