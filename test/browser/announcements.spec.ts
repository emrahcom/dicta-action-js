import { expect, type Page, test } from "@playwright/test";
import { holdRounds, openPage, ROUND, submit } from "./page.ts";

const status = '[role="status"]';

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
  await expect(page.locator(status)).toHaveText("Working");
  expect(await shownText(page)).not.toContain("Working");
});

test("Done is announced for a done without a text, not shown", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(status)).toHaveText("Working");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "done" } },
  });
  await expect(page.locator(status)).toHaveText("Done");
  expect(await shownText(page)).not.toContain("Done");
  await expect(page.locator('[part~="notice"]')).toBeHidden();
});

test("a done with a text announces its text, not Done", async ({ page }) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(status)).toHaveText("Working");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "done", text: "Moved 2 tasks." } },
  });
  await expect(page.locator(status)).toHaveText("Moved 2 tasks.");
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
  await expect(page.locator(status)).toHaveText("Bitte warten");
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "done" } },
  });
  await expect(page.locator(status)).toHaveText("Fertig");
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
  await expect(page.locator(status)).toHaveText("Working");
});

test("a stop is still announced when held text starts a new request", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(status)).toHaveText("Working");
  await submit(page, "b");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "stop", text: "No." } },
  });
  // The held text starts a new request at once; the stop is read first.
  await expect(page.locator(status)).toHaveText("No. Working");
  await expect.poll(() => routes.length).toBe(2);
});
