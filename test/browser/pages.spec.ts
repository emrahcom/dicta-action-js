import { expect, type Page, test } from "@playwright/test";
import { history, holdRounds, replies, ROUND, submit } from "./page.ts";

const list = { call: "tasks.list", args: {} };
const navigated = { code: "navigated", message: "The page changed" };

async function openApp(page: Page) {
  await page.goto("/app");
  await page.waitForFunction(
    () =>
      (document.querySelector("dicta-action") as unknown as { module?: object })
        ?.module !== undefined,
  );
}

test("a step that loads a page reports navigated at the next step", async ({
  page,
}) => {
  const plan = {
    steps: [
      { ...list, includeOutput: true },
      { call: "page.reload", args: {} },
      list,
    ],
  };
  const bodies = await replies(page, { type: "plan", plan }, { type: "done" });
  await openApp(page);
  await submit(page, "reload");
  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(2);
  expect(bodies[1]).toMatchObject({
    requestId: "r1",
    text: "reload",
    state: { page: "app" },
    exchange: [
      {
        plan,
        report: {
          outputs: { 1: [{ id: "t1" }, { id: "t2" }] },
          halt: { step: 3, ...navigated },
        },
      },
    ],
  });
  // The saved request is taken out once.
  expect(
    await page.evaluate(() => sessionStorage.getItem("dicta-action-saved")),
  ).toBeNull();
});

test("a page load as the last step has no halt", async ({ page }) => {
  const plan = { steps: [list, { call: "page.reload", args: {} }] };
  const bodies = await replies(page, { type: "plan", plan }, { type: "done" });
  await openApp(page);
  await submit(page, "reload");
  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(2);
  expect(bodies[1].exchange).toEqual([{ plan, report: {} }]);
});

test("a page load in a forEach reports its item and call", async ({ page }) => {
  const plan = {
    steps: [
      list,
      {
        forEach: "$1",
        do: [{ call: "page.reload", args: { id: "$item.id" } }],
        includeOutput: true,
      },
    ],
  };
  const bodies = await replies(page, { type: "plan", plan }, { type: "done" });
  await openApp(page);
  await submit(page, "reload");
  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(2);
  expect(bodies[1].exchange).toEqual([
    {
      plan,
      report: {
        halt: { step: 2, ...navigated, item: 1, do: 0, outputs: [[null], []] },
      },
    },
  ]);
});

test("a saved request older than 60 seconds ends as cancelled", async ({
  page,
}) => {
  let rounds = 0;
  await page.route(ROUND, () => {
    rounds += 1;
  });
  await openApp(page);
  const plan = { steps: [list] };
  await page.evaluate(
    (saved) => {
      sessionStorage.setItem("dicta-action-saved", JSON.stringify(saved));
    },
    {
      savedAt: Date.now() - 61_000,
      requestId: "r5",
      text: "old",
      exchange: [{ plan, report: { halt: { step: 1, ...navigated } } }],
      added: ["and more"],
    },
  );
  await openApp(page);
  await expect.poll(async () => (await history(page)).length).toBe(1);
  expect((await history(page))[0]).toMatchObject({
    requestId: "r5",
    outcome: { type: "cancelled" },
    exchange: [
      { plan, report: { halt: { step: 1, ...navigated } } },
      { added: "and more" },
    ],
  });
  expect(rounds).toBe(0);
});

test("a page load while a question is open ends the request", async ({
  page,
}) => {
  await replies(page, { type: "question", text: "When?" });
  await openApp(page);
  await submit(page, "move it");
  await expect(page.locator('[part~="text"]')).toHaveText("When?");
  await openApp(page);
  expect((await history(page))[0]).toMatchObject({
    requestId: "r1",
    outcome: { type: "cancelled" },
    exchange: [],
  });
  await expect(page.locator('[part~="view"]')).toBeHidden();
});

test("a page load while waiting keeps the unsent report", async ({ page }) => {
  const plan = { steps: [list] };
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    if (rounds === 1) {
      return route.fulfill({
        json: { requestId: "r1", reply: { type: "plan", plan } },
      });
    }
  });
  await openApp(page);
  await submit(page, "list");
  await expect.poll(() => rounds).toBe(2);
  await openApp(page);
  expect((await history(page))[0]).toMatchObject({
    outcome: { type: "cancelled" },
    exchange: [{ plan, report: {} }],
  });
});

test("a page load at a confirmation ends with a cancelled report", async ({
  page,
}) => {
  const plan = { steps: [{ call: "tasks.delete", args: { id: "t1" } }] };
  await replies(page, { type: "plan", plan });
  await openApp(page);
  await submit(page, "delete");
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await openApp(page);
  expect((await history(page))[0]).toMatchObject({
    outcome: { type: "cancelled" },
    exchange: [
      {
        plan,
        report: { halt: { step: 1, code: "cancelled", message: "Cancelled" } },
      },
    ],
  });
});

test("a page load before the first reply stores nothing", async ({ page }) => {
  const routes = await holdRounds(page);
  await openApp(page);
  await submit(page, "a");
  await expect.poll(() => routes.length).toBe(1);
  await openApp(page);
  expect(await history(page)).toEqual([]);
});

test("a failed round while leaving is an error when the page stays", async ({
  page,
}) => {
  await page.route(ROUND, (route) => route.abort());
  await openApp(page);
  // A page load that starts and is called off, as by a "leave page?" prompt.
  await page.evaluate(() => dispatchEvent(new Event("beforeunload")));
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText(
    "Something went wrong",
  );
});

test("text from before the page load goes on in the new page", async ({
  page,
}) => {
  const plan = { steps: [{ call: "page.reloadLater", args: {} }] };
  const bodies = await replies(page, { type: "plan", plan }, { type: "done" });
  await openApp(page);
  await submit(page, "reload");
  await page.waitForFunction(() => "release" in window);
  await submit(page, "and more");
  await page.evaluate(() =>
    (window as unknown as { release: () => void }).release(),
  );
  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(2);
  expect(bodies[1].exchange).toEqual([
    { plan, report: {} },
    { added: "and more" },
  ]);
});

test("after Stay at the leave prompt text is ignored until Cancel", async ({
  page,
}) => {
  const plan = { steps: [{ call: "page.reload", args: {} }, list] };
  const bodies = await replies(page, { type: "plan", plan });
  await openApp(page);
  // The leave prompt needs a click on the page first; Stay dismisses it.
  await page.evaluate(() =>
    addEventListener("beforeunload", (event) => event.preventDefault()),
  );
  await page.mouse.click(1, 1);
  page.on("dialog", (dialog) => void dialog.dismiss());
  await submit(page, "go");
  await expect.poll(() => bodies.length).toBe(1);
  await expect(page.locator('[part~="indicator"]')).toBeVisible();
  await submit(page, "and more");
  await expect(page.locator('[part~="notice"]')).toHaveText(
    "Wait for the page to load",
  );
  // The plan does not go on and no round is sent.
  await page.waitForTimeout(300);
  expect(bodies.length).toBe(1);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator('[part~="view"]')).toBeHidden();
  expect((await history(page))[0]).toMatchObject({
    outcome: { type: "cancelled" },
    exchange: [{ plan, report: { halt: { step: 2, ...navigated } } }],
  });
});

test("a hash change does not stop the plan", async ({ page }) => {
  const plan = {
    steps: [
      { call: "page.hash", args: {} },
      { ...list, includeOutput: true },
    ],
  };
  const bodies = await replies(page, { type: "plan", plan }, { type: "done" });
  await openApp(page);
  await submit(page, "top");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].exchange).toEqual([
    { plan, report: { outputs: { 2: [{ id: "t1" }, { id: "t2" }] } } },
  ]);
});
