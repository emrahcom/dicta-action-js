import { expect, test } from "@playwright/test";
import {
  finishStep,
  holdRounds,
  holdStep,
  openPage,
  replies,
  runs,
  submit,
} from "./page.ts";

const done = { type: "done" };
const list = { call: "tasks.list", args: {} };
const twoSteps = { type: "plan", plan: { steps: [list, list] } };

test("added text halts the plan after the running step", async ({ page }) => {
  const bodies = await replies(page, twoSteps, done);
  await openPage(page);
  await holdStep(page, "tasks.list");
  await submit(page, "show the tasks");
  await expect.poll(() => runs(page)).toBe(1);
  await submit(page, "and the closed ones");
  await submit(page, "from this week");
  await finishStep(page);
  await expect.poll(() => bodies.length).toBe(2);
  expect(await runs(page)).toBe(1);
  expect(bodies[1].exchange).toEqual([
    {
      plan: twoSteps.plan,
      report: {
        halt: { step: 2, code: "interrupted", message: "The user added text" },
      },
    },
    { added: "and the closed ones" },
    { added: "from this week" },
  ]);
});

test("added text after the last step follows the report", async ({ page }) => {
  const plan = { steps: [list] };
  const bodies = await replies(page, { type: "plan", plan }, done);
  await openPage(page);
  await holdStep(page, "tasks.list");
  await submit(page, "show the tasks");
  await expect.poll(() => runs(page)).toBe(1);
  await submit(page, "and the closed ones");
  await finishStep(page);
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].exchange).toEqual([
    { plan, report: {} },
    { added: "and the closed ones" },
  ]);
});

test("text while waiting drops a plan and goes to the server", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await holdStep(page, "tasks.list");
  await submit(page, "show the tasks");
  await expect.poll(() => routes.length).toBe(1);
  await submit(page, "only mine");
  await routes[0].fulfill({ json: { requestId: "r7", reply: twoSteps } });
  await expect.poll(() => routes.length).toBe(2);
  expect(routes[1].request().postDataJSON()).toMatchObject({
    requestId: "r7",
    text: "show the tasks",
    exchange: [{ added: "only mine" }],
  });
  expect(await runs(page)).toBe(0);
});

test("text while waiting drops a question too", async ({ page }) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "move the tasks");
  await expect.poll(() => routes.length).toBe(1);
  await submit(page, "to Friday");
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "question", text: "When?" } },
  });
  await expect.poll(() => routes.length).toBe(2);
  expect(routes[1].request().postDataJSON()).toMatchObject({
    exchange: [{ added: "to Friday" }],
  });
  await expect(page.locator('[part~="option"]')).toHaveCount(0);
});

test("text while waiting starts a new request after done", async ({ page }) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "first");
  await expect.poll(() => routes.length).toBe(1);
  await submit(page, "second");
  await routes[0].fulfill({ json: { requestId: "r1", reply: done } });
  await expect.poll(() => routes.length).toBe(2);
  const body = routes[1].request().postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ text: "second", exchange: [] });
  expect(body).not.toHaveProperty("requestId");
});

test("Cancel during a plan lets the step finish and runs nothing after", async ({
  page,
}) => {
  const bodies = await replies(page, twoSteps, done);
  await openPage(page);
  await holdStep(page, "tasks.list");
  await submit(page, "show the tasks");
  await expect.poll(() => runs(page)).toBe(1);
  await page.getByRole("button", { name: "Cancel" }).click();
  await finishStep(page);
  await page.waitForTimeout(200);
  expect(await runs(page)).toBe(1);
  expect(bodies.length).toBe(1);
  await expect(page.locator('[part~="view"]')).toBeHidden();
});

test("text over 10000 characters is not taken", async ({ page }) => {
  const bodies = await replies(page, done);
  await openPage(page);
  await submit(page, "a".repeat(10001));
  await expect(page.locator('[part~="notice"]')).toHaveText(
    "The text is too long",
  );
  await page.waitForTimeout(200);
  expect(bodies.length).toBe(0);
  await submit(page, "\u{1F600}".repeat(10000));
  await expect.poll(() => bodies.length).toBe(1);
});

test("a too long answer leaves the question open", async ({ page }) => {
  const bodies = await replies(page, { type: "question", text: "When?" });
  await openPage(page);
  await submit(page, "move the tasks");
  await expect(page.locator('[part~="text"]')).toHaveText("When?");
  await submit(page, "a".repeat(10001));
  await expect(page.locator('[part~="notice"]')).toHaveText(
    "The text is too long",
  );
  await expect(page.locator('[part~="text"]')).toHaveText("When?");
  expect(bodies.length).toBe(1);
});

test("several held texts: the first starts a request, the rest are added", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "first");
  await expect.poll(() => routes.length).toBe(1);
  await submit(page, "second");
  await submit(page, "third");
  await routes[0].fulfill({ json: { requestId: "r1", reply: done } });
  await expect.poll(() => routes.length).toBe(2);
  expect(routes[1].request().postDataJSON()).toMatchObject({
    text: "second",
    exchange: [],
  });
  // "third" waits as added text of the new request: the question is dropped.
  await routes[1].fulfill({
    json: { requestId: "r2", reply: { type: "question", text: "When?" } },
  });
  await expect.poll(() => routes.length).toBe(3);
  expect(routes[2].request().postDataJSON()).toMatchObject({
    requestId: "r2",
    text: "second",
    exchange: [{ added: "third" }],
  });
});
