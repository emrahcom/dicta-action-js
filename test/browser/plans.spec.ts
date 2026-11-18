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

test("a step's text replaces the label and is announced once", async ({
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
  // The step's text follows the plan's label; the second step has none.
  await expect(page.locator('[role="status"]')).toHaveText(
    "Working Listing the tasks Reading the tasks",
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

// Old outputs (contract-protocol.md in dicta-action-server, Request body).

test("plans before the last two keep only their small outputs", async ({
  page,
}) => {
  const plan = {
    type: "plan",
    plan: {
      steps: [
        { call: "tasks.list", args: {}, includeOutput: true },
        { call: "tasks.list", args: {}, includeOutput: true },
      ],
    },
  };
  const bodies = await replies(page, plan, plan, plan, done);
  await openPage(page);
  // A list of 30 tasks, well over 512 bytes.
  const tasks = Array.from({ length: 30 }, (_, i) => ({
    id: `t${i}`,
    title: "x".repeat(20),
  }));
  // The first call of each plan returns the large list, the second a small one.
  await page.evaluate((list) => {
    const element = document.querySelector("dicta-action") as unknown as {
      module: { capabilities: Record<string, { run: () => Promise<unknown> }> };
    };
    let calls = 0;
    element.module.capabilities["tasks.list"].run = async () => {
      calls += 1;
      return calls % 2 === 1 ? list : [{ id: "t9" }];
    };
  }, tasks);
  await submit(page, "a");
  await expect.poll(() => bodies.length).toBe(4);
  const full = { outputs: { 1: tasks, 2: [{ id: "t9" }] } };
  expect(bodies[3].exchange).toEqual([
    {
      plan: plan.plan,
      report: {
        outputs: { 2: [{ id: "t9" }] },
        tooLarge: { 1: JSON.stringify(tasks).length },
      },
    },
    { plan: plan.plan, report: full },
    { plan: plan.plan, report: full },
  ]);
});

test("a forEach announces its text once, not for each item", async ({
  page,
}) => {
  const rounds = await planThenHold(page, {
    steps: [
      { call: "tasks.list", args: {} },
      {
        forEach: "$1",
        do: [{ call: "tasks.delete", args: { id: "$item.id" } }],
        text: "Deleting the tasks",
      },
    ],
  });
  await page.clock.install();
  await openPage(page);
  await pauseClock(page);
  await submit(page, "a");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(rounds).toBe(2);
  await page.clock.runFor(ANNOUNCE_DELAY_MS);
  // Working, the confirmation, then the step's text once: no count, and no
  // repeat for the second item.
  await expect(page.locator('[role="status"]')).toHaveText(
    "Working Delete task t1 Delete task t2 Deleting the tasks",
  );
});
