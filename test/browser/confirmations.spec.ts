import { expect, type Page, test } from "@playwright/test";
import { deleted, holdStep, openPage, replies, submit } from "./page.ts";

const done = { type: "done" };
const text = '[part~="text"]';

function inState(page: Page, state: string) {
  return page.evaluate(
    (name) =>
      document.querySelector("dicta-action")?.matches(`:state(${name})`),
    state,
  );
}

const deleteOne = {
  type: "plan",
  plan: {
    steps: [{ call: "tasks.delete", args: { id: "t1" } }],
    text: "Deleting the task",
  },
};

test("a destructive step shows the confirmation view", async ({ page }) => {
  await replies(page, deleteOne, done);
  await openPage(page);
  await submit(page, "delete it");
  await expect(page.locator(text)).toHaveText("Delete task t1");
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  // The confirmation shows only the module's words, not the plan's label.
  await expect(page.locator('[part~="label"]')).toHaveCount(0);
  expect(await inState(page, "confirmation")).toBe(true);
  await expect(page.locator('[role="status"]')).toHaveText(
    "Working Deleting the task Delete task t1",
  );
  expect(await deleted(page)).toEqual([]);
});

test("Continue runs the step and reports it", async ({ page }) => {
  const bodies = await replies(page, deleteOne, done);
  await openPage(page);
  await submit(page, "delete it");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(await deleted(page)).toEqual(["t1"]);
  expect(bodies[1].exchange).toEqual([{ plan: deleteOne.plan, report: {} }]);
});

test("Cancel ends the request without running the step", async ({ page }) => {
  const bodies = await replies(page, deleteOne, done);
  await openPage(page);
  await submit(page, "delete it");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator('[part~="view"]')).toBeHidden();
  await page.waitForTimeout(200);
  expect(await deleted(page)).toEqual([]);
  expect(bodies.length).toBe(1);
});

test("text during a confirmation is ignored", async ({ page }) => {
  const bodies = await replies(page, deleteOne, done);
  await openPage(page);
  await submit(page, "delete it");
  await expect(page.locator(text)).toHaveText("Delete task t1");
  await submit(page, "yes");
  await page.waitForTimeout(200);
  expect(await inState(page, "confirmation")).toBe(true);
  expect(await deleted(page)).toEqual([]);
  expect(bodies.length).toBe(1);
});

function deleteEach() {
  return {
    type: "plan",
    plan: {
      steps: [
        { call: "tasks.list", args: {} },
        {
          forEach: "$1",
          do: [{ call: "tasks.delete", args: { id: "$item.id" } }],
        },
      ],
    },
  };
}

test("a forEach shows its first three items and the count", async ({
  page,
}) => {
  await replies(page, deleteEach(), done);
  await openPage(page);
  // A list of five tasks.
  await page.evaluate(() => {
    const element = document.querySelector("dicta-action") as unknown as {
      module: { capabilities: Record<string, { run: () => Promise<unknown> }> };
    };
    element.module.capabilities["tasks.list"].run = async () =>
      ["t1", "t2", "t3", "t4", "t5"].map((id) => ({ id }));
  });
  await submit(page, "delete all");
  await expect(page.locator(text)).toHaveText([
    "Delete task t1",
    "Delete task t2",
    "Delete task t3",
    "5 items",
  ]);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect
    .poll(() => deleted(page))
    .toEqual(["t1", "t2", "t3", "t4", "t5"]);
});

test("a forEach of two items has no count", async ({ page }) => {
  await replies(page, deleteEach(), done);
  await openPage(page);
  await submit(page, "delete all");
  await expect(page.locator(text)).toHaveText([
    "Delete task t1",
    "Delete task t2",
  ]);
});

test("strings override Continue and the item count", async ({ page }) => {
  await replies(page, deleteEach(), done);
  await openPage(page);
  await page.evaluate(() => {
    const element = document.querySelector("dicta-action") as unknown as {
      strings: Record<string, string>;
      module: { capabilities: Record<string, { run: () => Promise<unknown> }> };
    };
    element.strings = { continue: "Weiter", items: "{count} Aufgaben" };
    element.module.capabilities["tasks.list"].run = async () =>
      ["t1", "t2", "t3", "t4"].map((id) => ({ id }));
  });
  await submit(page, "delete all");
  await expect(page.getByRole("button", { name: "Weiter" })).toBeVisible();
  await expect(page.locator(text).last()).toHaveText("4 Aufgaben");
});

test("the focus moves from Continue to the working view's Cancel", async ({
  page,
}) => {
  await replies(page, deleteOne);
  await openPage(page);
  // The step is held, so the working view stays after Continue.
  await holdStep(page, "tasks.delete");
  await submit(page, "delete it");
  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[part~="indicator"]')).toBeVisible();
  await expect(page.locator('[part~="label"]')).toHaveText("Deleting the task");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
});

test("many steps of one write capability ask once with the count", async ({
  page,
}) => {
  const steps = ["t1", "t2", "t3"].map((id) => ({
    call: "tasks.update",
    args: { id },
  }));
  await replies(page, { type: "plan", plan: { steps } }, done);
  await openPage(page);
  await page.evaluate(() => {
    const element = document.querySelector("dicta-action") as unknown as {
      module: { confirmOver?: number; capabilities: Record<string, unknown> };
    };
    element.module.confirmOver = 2;
    element.module.capabilities["tasks.update"] = {
      level: "write",
      desc: "Updates a task.",
      args: { type: "object", properties: { id: { type: "string" } } },
      confirm: async ({ id }: { id: string }) => `Update task ${id}`,
      run: async ({ id }: { id: string }) => ({ id }),
    };
  });
  await submit(page, "update them");
  await expect(page.locator(text)).toHaveText(["Update task t1", "3 items"]);
  expect(await inState(page, "confirmation")).toBe(true);
});
