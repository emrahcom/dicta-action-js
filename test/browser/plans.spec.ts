import { expect, test } from "@playwright/test";
import { openPage, replies, ROUND, submit } from "./page.ts";

const done = { type: "done" };

test("a plan runs and its report goes into the next round", async ({
  page,
}) => {
  const plan = {
    steps: [
      { call: "tasks.list", args: {}, includeOutput: true },
      { call: "tasks.get", args: { id: "$1.0.id" } },
    ],
    final: true,
  };
  const bodies = await replies(page, { type: "plan", plan }, done);
  await openPage(page);
  await submit(page, "show the tasks");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({
    requestId: "r1",
    exchange: [
      {
        plan,
        report: {
          outputs: {
            1: [
              { id: "t1", title: "Budget" },
              { id: "t2", title: "Review" },
            ],
          },
        },
      },
    ],
  });
  await expect(page.locator('[part~="view"]')).toBeHidden();
});

test("a halted plan is reported too", async ({ page }) => {
  const plan = { steps: [{ call: "tasks.get", args: { id: "t9" } }] };
  const bodies = await replies(page, { type: "plan", plan }, done);
  await openPage(page);
  await submit(page, "a");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].exchange).toEqual([
    {
      plan,
      report: { halt: { step: 1, code: "not_found", message: "No such task" } },
    },
  ]);
});

test("an invalid plan is reported without running a step", async ({ page }) => {
  const plan = { steps: [{ call: "tasks.fly", args: {} }] };
  const bodies = await replies(page, { type: "plan", plan }, done);
  await openPage(page);
  await submit(page, "a");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].exchange).toEqual([
    {
      plan,
      report: {
        halt: {
          code: "invalid",
          message: "steps[0].call names no capability: tasks.fly",
        },
      },
    },
  ]);
});

test("the working view shows and announces the plan's label", async ({
  page,
}) => {
  const plan = {
    steps: [{ call: "tasks.list", args: {} }],
    text: "Listing the tasks",
  };
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    // The second round is held, so the label can be seen.
    if (rounds === 1) {
      return route.fulfill({
        json: { requestId: "r1", reply: { type: "plan", plan } },
      });
    }
  });
  await openPage(page);
  // Holds the plan's only step until the test has seen the label.
  await page.evaluate(() => {
    const element = document.querySelector("dicta-action") as unknown as {
      module: { capabilities: Record<string, { run: () => Promise<unknown> }> };
    };
    element.module.capabilities["tasks.list"].run = () =>
      new Promise((resolve) => {
        (window as unknown as { finish: () => void }).finish = () =>
          resolve([]);
      });
  });
  await submit(page, "a");
  await expect(page.locator('[part~="label"]')).toHaveText("Listing the tasks");
  await expect(page.locator('[role="status"]')).toHaveText("Listing the tasks");
  await page.evaluate(() =>
    (window as unknown as { finish: () => void }).finish(),
  );
  // While the report is sent, the working view has no label.
  await expect.poll(() => rounds).toBe(2);
  await expect(page.locator('[part~="label"]')).toHaveText("");
});

test("a request goes through a plan, a question and done", async ({ page }) => {
  const plan = { steps: [{ call: "tasks.list", args: {} }] };
  const bodies = await replies(
    page,
    { type: "plan", plan },
    { type: "question", text: "Which one?", options: ["Budget", "Review"] },
    { type: "done", text: "Opened Budget." },
  );
  await openPage(page);
  await submit(page, "open a task");
  await page.getByRole("button", { name: "Budget" }).click();
  await expect(page.locator('[part~="notice"]')).toHaveText("Opened Budget.");
  expect(bodies[2].exchange).toEqual([
    { plan, report: {} },
    { question: "Which one?", answer: "Budget" },
  ]);
});

test("Cancel while a plan runs sends no report", async ({ page }) => {
  const plan = { steps: [{ call: "tasks.list", args: {} }] };
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    return route.fulfill({
      json: { requestId: "r1", reply: { type: "plan", plan } },
    });
  });
  await openPage(page);
  await page.evaluate(() => {
    const element = document.querySelector("dicta-action") as unknown as {
      module: { capabilities: Record<string, { run: () => Promise<unknown> }> };
    };
    element.module.capabilities["tasks.list"].run = () =>
      new Promise((resolve) => {
        (window as unknown as { finish: () => void }).finish = () =>
          resolve([]);
      });
  });
  await submit(page, "a");
  await expect(page.locator('[part~="indicator"]')).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.evaluate(() =>
    (window as unknown as { finish: () => void }).finish(),
  );
  await page.waitForTimeout(200);
  expect(rounds).toBe(1);
  await expect(page.locator('[part~="view"]')).toBeHidden();
});
