import { expect, test } from "@playwright/test";
import { openPage, replies, submit } from "./page.ts";

const notice = '[part~="notice"]';

test("a notice hidden under the pointer does not keep the next one", async ({
  page,
}) => {
  await page.clock.install();
  await replies(
    page,
    { type: "done", text: "First." },
    { type: "stop", text: "No." },
    { type: "done", text: "Second." },
  );
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  await page.locator(notice).hover();
  // A new request hides the notice while the pointer is over it.
  await submit(page, "b");
  await page.getByRole("button", { name: "Close" }).click();
  await page.mouse.move(0, 0);
  await submit(page, "c");
  await expect(page.locator(notice)).toHaveText("Second.");
  await page.clock.runFor(1100);
  await expect(page.locator(notice)).toBeHidden();
});

test("a notice hidden with the focus does not keep the next one", async ({
  page,
}) => {
  await page.clock.install();
  await replies(
    page,
    { type: "done", text: "First." },
    { type: "done", text: "Second." },
  );
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  await page.locator(notice).focus();
  await submit(page, "b");
  await expect(page.locator(notice)).toHaveText("Second.");
  await page.clock.runFor(1100);
  await expect(page.locator(notice)).toBeHidden();
});

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
  await expect.poll(seen).toEqual(["No."]);
  await submit(page, "b");
  // Cleared before the equal text, so screen readers notice the change.
  await expect.poll(seen).toEqual(["No.", "", "No."]);
});
