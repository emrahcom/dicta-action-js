import { expect, test } from "@playwright/test";
import { holdRounds, openPage, replies, submit } from "./page.ts";

const question = {
  type: "question",
  text: "Which Friday?",
  options: ["This week", "Next week"],
};

function inState(page: import("@playwright/test").Page, state: string) {
  return page.evaluate(
    (name) =>
      document.querySelector("dicta-action")?.matches(`:state(${name})`),
    state,
  );
}

test("a question shows its text, its options and Cancel", async ({ page }) => {
  await replies(page, question);
  await openPage(page);
  await submit(page, "move the tasks");
  await expect(page.locator('[part~="text"]')).toHaveText("Which Friday?");
  await expect(page.locator('[part~="option"]')).toHaveText([
    "This week",
    "Next week",
  ]);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(await inState(page, "question")).toBe(true);
  await expect(page.locator('[role="status"]')).toHaveText("Which Friday?");
});

test("a submit answers the question in the next round", async ({ page }) => {
  const bodies = await replies(page, question, { type: "done" });
  await openPage(page);
  await submit(page, "move the tasks");
  await expect(page.locator('[part~="option"]')).toHaveCount(2);
  await submit(page, "  the one after  ");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]).not.toHaveProperty("requestId");
  expect(bodies[1]).toMatchObject({
    requestId: "r1",
    text: "move the tasks",
    exchange: [{ question: "Which Friday?", answer: "the one after" }],
  });
  await expect(page.locator('[part~="view"]')).toBeHidden();
});

test("a click on an option answers with its text", async ({ page }) => {
  const bodies = await replies(page, question, { type: "done" });
  await openPage(page);
  await submit(page, "move the tasks");
  await page.getByRole("button", { name: "Next week" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].exchange).toEqual([
    { question: "Which Friday?", answer: "Next week" },
  ]);
});

test("the working view comes back while the answer is sent", async ({
  page,
}) => {
  await replies(page, question);
  await openPage(page);
  await submit(page, "move the tasks");
  await expect(page.locator('[part~="option"]')).toHaveCount(2);
  await page.unrouteAll();
  await holdRounds(page);
  await submit(page, "next week");
  await expect(page.locator('[part~="indicator"]')).toBeVisible();
  expect(await inState(page, "working")).toBe(true);
});

test("the exchange grows over several questions", async ({ page }) => {
  const bodies = await replies(
    page,
    question,
    { type: "question", text: "Also the closed ones?" },
    { type: "done" },
  );
  await openPage(page);
  await submit(page, "move the tasks");
  await expect(page.locator('[part~="text"]')).toHaveText("Which Friday?");
  await submit(page, "next week");
  await expect(page.locator('[part~="text"]')).toHaveText(
    "Also the closed ones?",
  );
  await expect(page.locator('[part~="option"]')).toHaveCount(0);
  await submit(page, "yes");
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2].exchange).toEqual([
    { question: "Which Friday?", answer: "next week" },
    { question: "Also the closed ones?", answer: "yes" },
  ]);
});

test("Cancel during a question ends the request", async ({ page }) => {
  const bodies = await replies(page, question, { type: "done" });
  await openPage(page);
  await submit(page, "move the tasks");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator('[part~="view"]')).toBeHidden();
  // The next text starts a new request instead of answering.
  await submit(page, "something else");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ text: "something else", exchange: [] });
  expect(bodies[1]).not.toHaveProperty("requestId");
});

test("the focus moves from Cancel to the question's Cancel", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "move the tasks");
  await page.getByRole("button", { name: "Cancel" }).focus();
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({ json: { requestId: "r1", reply: question } });
  await expect(page.locator('[part~="option"]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
});
