import { expect, type Page, test } from "@playwright/test";
import {
  ANNOUNCE_DELAY_MS,
  holdRounds,
  NOTICE,
  openPage,
  pauseClock,
  ROUND,
  STATUS,
  submit,
} from "./page.ts";

// The element's visible text, without the status region.
function shownText(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("dicta-action")!.shadowRoot!;
    return [...root.children]
      .filter((child) => child.getAttribute("role") !== "status")
      .map((child) => (child as HTMLElement).innerText ?? "")
      .join(" ");
  });
}

test("Working is announced when a request starts, not shown", async ({
  page,
}) => {
  await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(STATUS)).toHaveText("Working");
  expect(await shownText(page)).not.toContain("Working");
});

test("Done is announced for a done without a text, not shown", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(STATUS)).toHaveText("Working");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "done" } },
  });
  await expect(page.locator(STATUS)).toHaveText("Done");
  expect(await shownText(page)).not.toContain("Done");
  await expect(page.locator(NOTICE)).toBeHidden();
});

test("a done with a text announces its text, not Done", async ({ page }) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(STATUS)).toHaveText("Working");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "done", text: "Moved 2 tasks." } },
  });
  await expect(page.locator(STATUS)).toHaveText("Moved 2 tasks.");
});

test("strings override Working and Done", async ({ page }) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await page.evaluate(() =>
    Object.assign(document.querySelector("dicta-action")!, {
      strings: { working: "Bitte warten", done: "Fertig" },
    }),
  );
  await submit(page, "a");
  await expect(page.locator(STATUS)).toHaveText("Bitte warten");
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "done" } },
  });
  await expect(page.locator(STATUS)).toHaveText("Fertig");
});

test("Working is announced when a request goes on in a new page", async ({
  page,
}) => {
  const plan = { steps: [{ call: "page.reload", args: {} }] };
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    // The round in the new page is held, so Working stays announced.
    if (rounds === 1) {
      return route.fulfill({
        json: { requestId: "r1", reply: { type: "plan", plan } },
      });
    }
  });
  await page.goto("/app");
  await page.waitForFunction(
    () =>
      (document.querySelector("dicta-action") as unknown as { module?: object })
        ?.module !== undefined,
  );
  await submit(page, "reload");
  await expect.poll(() => rounds, { timeout: 10_000 }).toBe(2);
  await expect(page.locator(STATUS)).toHaveText("Working");
});

test("a stop is still announced when held text starts a new request", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(STATUS)).toHaveText("Working");
  await submit(page, "b");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "stop", text: "No." } },
  });
  // The held text starts a new request at once; the stop is read first.
  await expect(page.locator(STATUS)).toHaveText("No. Working");
  await expect.poll(() => routes.length).toBe(2);
});

test("an equal text is announced again", async ({ page }) => {
  await page.clock.install();
  const routes = await holdRounds(page);
  await openPage(page);
  await pauseClock(page);
  await page.evaluate((selector) => {
    const region = document
      .querySelector("dicta-action")!
      .shadowRoot!.querySelector(selector)!;
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    // Every value the region takes, empty ones too.
    new MutationObserver(() => {
      seen.push(region.textContent ?? "");
    }).observe(region, { childList: true, characterData: true, subtree: true });
  }, STATUS);
  const seen = () =>
    page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  const notice = page.locator(NOTICE);
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
