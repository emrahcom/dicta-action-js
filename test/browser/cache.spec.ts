import { expect, type Page, test } from "@playwright/test";
import { history, openPage, replies, ROUND, submit } from "./page.ts";

function fire(page: Page, type: string, persisted = false) {
  return page.evaluate(
    ([name, cached]) =>
      dispatchEvent(new PageTransitionEvent(name, { persisted: cached })),
    [type, persisted] as const,
  );
}

test("pagehide hides the view of a request that is over", async ({ page }) => {
  await replies(page, { type: "question", text: "When?" });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText("When?");
  await fire(page, "pagehide");
  await expect(page.locator('[part~="view"]')).toBeHidden();
  expect((await history(page))[0]).toMatchObject({
    outcome: { type: "cancelled" },
  });
});

test("pagehide hides a stop view and a notice", async ({ page }) => {
  await replies(page, { type: "stop", text: "No." });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText("No.");
  await fire(page, "pagehide");
  await expect(page.locator('[part~="view"]')).toBeHidden();
  await page.unrouteAll();
  await replies(page, { type: "done", text: "Done it." });
  await submit(page, "b");
  await expect(page.locator('[part~="notice"]')).toHaveText("Done it.");
  await fire(page, "pagehide");
  await expect(page.locator('[part~="notice"]')).toBeHidden();
});

test("after pagehide a failed round is an error at once", async ({ page }) => {
  await page.route(ROUND, (route) => route.abort());
  await openPage(page);
  await page.evaluate(() => dispatchEvent(new Event("beforeunload")));
  await fire(page, "pagehide");
  await submit(page, "a");
  // Well under the one second a leaving page waits.
  await expect(page.locator('[part~="text"]')).toHaveText(
    "Something went wrong",
    { timeout: 500 },
  );
});

const saved = {
  requestId: "r3",
  text: "open the task",
  exchange: [],
  plan: { steps: [{ call: "tasks.list", args: {} }] },
  report: {
    halt: { step: 1, code: "navigated", message: "The page changed" },
  },
};

test("pageshow from the cache goes on with a saved request", async ({
  page,
}) => {
  const bodies = await replies(page, { type: "done" });
  await openPage(page);
  await page.evaluate((value) => {
    sessionStorage.setItem(
      "dicta-action-saved",
      JSON.stringify({ ...value, savedAt: Date.now() }),
    );
  }, saved);
  await fire(page, "pageshow", true);
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({
    requestId: "r3",
    text: "open the task",
    exchange: [{ plan: saved.plan, report: saved.report }],
  });
});

test("a pageshow not from the cache leaves a saved request", async ({
  page,
}) => {
  const bodies = await replies(page, { type: "done" });
  await openPage(page);
  await page.evaluate((value) => {
    sessionStorage.setItem(
      "dicta-action-saved",
      JSON.stringify({ ...value, savedAt: Date.now() }),
    );
  }, saved);
  await fire(page, "pageshow");
  await page.waitForTimeout(200);
  expect(bodies.length).toBe(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("dicta-action-saved")),
  ).not.toBeNull();
});
