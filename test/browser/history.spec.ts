import { expect, test } from "@playwright/test";
import {
  finishStep,
  history,
  holdRounds,
  holdStep,
  openPage,
  replies,
  ROUND,
  runs,
  submit,
} from "./page.ts";

const list = { call: "tasks.list", args: {} };
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/;

test("a done request is stored with its exchange", async ({ page }) => {
  const plan = { steps: [list] };
  await replies(
    page,
    { type: "plan", plan },
    { type: "done", text: "Listed." },
  );
  await openPage(page);
  await submit(page, "list the tasks");
  await expect.poll(async () => (await history(page)).length).toBe(1);
  const [entry] = await history(page);
  expect(entry).toEqual({
    requestId: "r1",
    time: expect.stringMatching(TIME),
    text: "list the tasks",
    outcome: { type: "done", text: "Listed." },
    exchange: [{ plan, report: {} }],
  });
});

test("stops and infos are stored newest first", async ({ page }) => {
  await replies(
    page,
    { type: "stop", text: "No." },
    { type: "info", text: "Like this." },
    { type: "done" },
  );
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText("No.");
  await submit(page, "b");
  await expect(page.locator('[part~="text"]')).toHaveText("Like this.");
  await submit(page, "c");
  await expect.poll(async () => (await history(page)).length).toBe(3);
  expect((await history(page)).map((e) => e.outcome)).toEqual([
    { type: "done" },
    { type: "info", text: "Like this." },
    { type: "stop", text: "No." },
  ]);
});

test("an error in a later round is stored", async ({ page }) => {
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    return rounds === 1
      ? route.fulfill({
          json: { requestId: "r1", reply: { type: "question", text: "When?" } },
        })
      : route.fulfill({ status: 500, json: { error: "boom" } });
  });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText("When?");
  await submit(page, "now");
  await expect(page.locator('[part~="text"]')).toHaveText(
    "Something went wrong",
  );
  const [entry] = await history(page);
  expect(entry).toMatchObject({
    outcome: { type: "error" },
    exchange: [{ question: "When?", answer: "now" }],
  });
});

test("a request without a requestId is not stored", async ({ page }) => {
  await page.route(ROUND, (route) =>
    route.fulfill({ status: 500, json: { error: "boom" } }),
  );
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText(
    "Something went wrong",
  );
  const routes = await holdRounds(page);
  await submit(page, "b");
  await expect.poll(() => routes.length).toBe(1);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await history(page)).toEqual([]);
});

test("a cancel during a question is stored", async ({ page }) => {
  await replies(page, { type: "question", text: "When?" });
  await openPage(page);
  await submit(page, "a");
  await page.getByRole("button", { name: "Cancel" }).click();
  const [entry] = await history(page);
  expect(entry).toMatchObject({ outcome: { type: "cancelled" }, exchange: [] });
});

test("a cancel during a plan is stored after the step with its report", async ({
  page,
}) => {
  const plan = { steps: [list, list] };
  await replies(page, { type: "plan", plan });
  await openPage(page);
  await holdStep(page, "tasks.list");
  await submit(page, "a");
  await expect.poll(() => runs(page)).toBe(1);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await history(page)).toEqual([]);
  await finishStep(page);
  await expect.poll(async () => (await history(page)).length).toBe(1);
  const [entry] = await history(page);
  expect(entry).toMatchObject({
    outcome: { type: "cancelled" },
    exchange: [
      {
        plan,
        report: { halt: { step: 2, code: "cancelled", message: "Cancelled" } },
      },
    ],
  });
});

test("a cancel at a confirmation is stored with its report", async ({
  page,
}) => {
  const plan = { steps: [{ call: "tasks.delete", args: { id: "t1" } }] };
  await replies(page, { type: "plan", plan });
  await openPage(page);
  await submit(page, "a");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(async () => (await history(page)).length).toBe(1);
  const [entry] = await history(page);
  expect(entry).toMatchObject({
    outcome: { type: "cancelled" },
    exchange: [
      {
        plan,
        report: { halt: { step: 1, code: "cancelled" } },
      },
    ],
  });
});

test("a plan reads the history with the built-ins", async ({ page }) => {
  const plan = {
    steps: [
      { call: "dicta.listHistory", args: { limit: 1 } },
      {
        call: "dicta.getHistory",
        args: { requestId: "$1.0.requestId" },
        includeOutput: true,
      },
    ],
  };
  const bodies = await replies(
    page,
    { type: "done", text: "First." },
    { type: "plan", plan },
    { type: "done" },
  );
  await openPage(page);
  await page.evaluate(async () => {
    // The built module, as a site's capability module imports it.
    const url = "/dist/index.js";
    const { dictaCapabilities } = (await import(url)) as {
      dictaCapabilities: object;
    };
    const element = document.querySelector("dicta-action") as unknown as {
      module: { capabilities: object };
    };
    Object.assign(element.module.capabilities, dictaCapabilities);
  });
  await submit(page, "first");
  await expect.poll(async () => (await history(page)).length).toBe(1);
  await submit(page, "what did I do?");
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[1].context).toMatchObject({
    capabilities: expect.arrayContaining([
      expect.objectContaining({ name: "dicta.listHistory", level: "read" }),
    ]),
  });
  expect(bodies[2].exchange).toEqual([
    {
      plan,
      report: {
        outputs: {
          2: {
            requestId: "r1",
            time: expect.stringMatching(TIME),
            text: "first",
            outcome: { type: "done", text: "First." },
            exchange: [],
          },
        },
      },
    },
  ]);
});
