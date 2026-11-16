import { expect, type Page, test } from "@playwright/test";
import {
  ANNOUNCE_DELAY_MS,
  finishStep,
  holdRounds,
  holdStep,
  openPage,
  pauseClock,
  replies,
  ROUND,
  runs,
  submit,
} from "./page.ts";

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
  await page.clock.install();
  await openPage(page);
  await pauseClock(page);
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
  await page.clock.runFor(ANNOUNCE_DELAY_MS);
  await expect(page.locator('[role="status"]')).toHaveText(
    "Working Listing the tasks",
  );
  await page.evaluate(() =>
    (window as unknown as { finish: () => void }).finish(),
  );
  // While the report is sent, the working view shows Thinking, not announced.
  await expect.poll(() => rounds).toBe(2);
  await expect(page.locator('[part~="label"]')).toHaveText("Thinking...");
  await page.clock.runFor(ANNOUNCE_DELAY_MS);
  await expect(page.locator('[role="status"]')).toHaveText(
    "Working Listing the tasks",
  );
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
  await expect(page.locator('[part~="notice"] .text')).toHaveText(
    "Opened Budget.",
  );
  expect(bodies[2].exchange).toEqual([
    { plan, report: {} },
    { question: "Which one?", answer: "Budget" },
  ]);
});

// The working view's label: Thinking, step texts and a forEach's count
// (specs/architecture.md, Display).

const label = '[part~="label"]';

// Answers the first round with the plan and holds every later one.
async function planThenHold(page: Page, plan: unknown) {
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    if (rounds === 1) {
      return route.fulfill({
        json: { requestId: "r1", reply: { type: "plan", plan } },
      });
    }
  });
  return () => rounds;
}

// Makes tasks.delete wait for window.finish() on each call.
async function holdDeletes(page: Page) {
  await page.evaluate(() => {
    const element = document.querySelector("dicta-action") as unknown as {
      module: { capabilities: Record<string, { run: () => Promise<unknown> }> };
    };
    element.module.capabilities["tasks.delete"].run = () =>
      new Promise((resolve) => {
        (window as unknown as { finish: () => void }).finish = () =>
          resolve({});
      });
  });
}

test("the label is Thinking while the server has not answered", async ({
  page,
}) => {
  await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(label)).toHaveText("Thinking...");
});

test("strings override Thinking", async ({ page }) => {
  await holdRounds(page);
  await openPage(page);
  await page.evaluate(() =>
    Object.assign(document.querySelector("dicta-action")!, {
      strings: { thinking: "Einen Moment..." },
    }),
  );
  await submit(page, "a");
  await expect(page.locator(label)).toHaveText("Einen Moment...");
});

test("a step's text replaces the label while it runs, unannounced", async ({
  page,
}) => {
  const rounds = await planThenHold(page, {
    steps: [
      { call: "tasks.list", args: {}, text: "Reading the tasks" },
      { call: "tasks.list", args: {} },
    ],
    text: "Listing the tasks",
  });
  await page.clock.install();
  await openPage(page);
  await pauseClock(page);
  await holdStep(page, "tasks.list");
  await submit(page, "a");
  await expect(page.locator(label)).toHaveText("Reading the tasks");
  await finishStep(page);
  await expect.poll(() => runs(page)).toBe(2);
  await expect(page.locator(label)).toHaveText("Listing the tasks");
  await finishStep(page);
  await expect.poll(rounds).toBe(2);
  await expect(page.locator(label)).toHaveText("Thinking...");
  await page.clock.runFor(ANNOUNCE_DELAY_MS);
  await expect(page.locator('[role="status"]')).toHaveText(
    "Working Listing the tasks",
  );
});

for (const [name, text, shown] of [
  ["with a text", "Deleting the tasks", "Deleting the tasks "],
  ["without a text", undefined, ""],
] as const) {
  test(`a forEach ${name} shows its count as it goes`, async ({ page }) => {
    const rounds = await planThenHold(page, {
      steps: [
        { call: "tasks.list", args: {} },
        {
          forEach: "$1",
          do: [{ call: "tasks.delete", args: { id: "$item.id" } }],
          ...(text === undefined ? {} : { text }),
        },
      ],
    });
    await openPage(page);
    await holdDeletes(page);
    await submit(page, "a");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator(label)).toHaveText(`${shown}0/2`);
    await page.evaluate(() =>
      (window as unknown as { finish: () => void }).finish(),
    );
    await expect(page.locator(label)).toHaveText(`${shown}1/2`);
    await page.evaluate(() =>
      (window as unknown as { finish: () => void }).finish(),
    );
    await expect.poll(rounds).toBe(2);
    await expect(page.locator(label)).toHaveText("Thinking...");
  });
}
