import { expect, test } from "@playwright/test";
import { holdRounds, openPage, replies, reply, ROUND, submit } from "./page.ts";

const view = '[part~="view"]';
const notice = '[part~="notice"]';
const status = '[role="status"]';

test("importing the package defines the element", async ({ page }) => {
  await openPage(page);
  expect(
    await page.evaluate(
      () => document.querySelector("dicta-action")?.shadowRoot !== null,
    ),
  ).toBe(true);
  await expect(page.locator(view)).toBeHidden();
});

test("a submit sends the text in a round", async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route(ROUND, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: { requestId: "r1", reply: { type: "done" } },
    });
  });
  await openPage(page);
  await submit(page, "  move the tasks  ");
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ text: "move the tasks", exchange: [] });
});

test("empty text is ignored", async ({ page }) => {
  let rounds = 0;
  await page.route(ROUND, () => {
    rounds += 1;
  });
  await openPage(page);
  await submit(page, "   ");
  await page.waitForTimeout(200);
  expect(rounds).toBe(0);
  await expect(page.locator(view)).toBeHidden();
});

test("while waiting, the working view shows the indicator and Cancel", async ({
  page,
}) => {
  await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="indicator"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.querySelector("dicta-action")?.matches(":state(working)"),
    ),
  ).toBe(true);
});

test("text while waiting is held until the response", async ({ page }) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect.poll(() => routes.length).toBe(1);
  await submit(page, "b");
  await page.waitForTimeout(200);
  expect(routes.length).toBe(1);
});

test("Cancel ends the request and a late response is ignored", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(view)).toBeHidden();
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "stop", text: "Late." } },
  });
  await page.waitForTimeout(200);
  await expect(page.locator(view)).toBeHidden();
});

test("a done with a text is a notice that goes away", async ({ page }) => {
  await page.clock.install();
  await reply(page, { type: "done", text: "Moved 2 tasks." });
  await openPage(page, '<dicta-action notice-duration="2"></dicta-action>');
  await submit(page, "a");
  await expect(page.locator(notice)).toHaveText("Moved 2 tasks.");
  await expect(page.locator(view)).toBeHidden();
  await page.clock.runFor(1900);
  await expect(page.locator(notice)).toBeVisible();
  await page.clock.runFor(200);
  await expect(page.locator(notice)).toBeHidden();
});

test("a notice lasts 5 seconds without a valid duration", async ({ page }) => {
  await page.clock.install();
  await reply(page, { type: "done", text: "Done." });
  await openPage(page, '<dicta-action notice-duration="0"></dicta-action>');
  await submit(page, "a");
  await expect(page.locator(notice)).toBeVisible();
  await page.clock.runFor(4900);
  await expect(page.locator(notice)).toBeVisible();
  await page.clock.runFor(200);
  await expect(page.locator(notice)).toBeHidden();
});

test("a notice stays while the pointer is over it", async ({ page }) => {
  await page.clock.install();
  await reply(page, { type: "done", text: "Done." });
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  await page.locator(notice).hover();
  await page.clock.runFor(3000);
  await expect(page.locator(notice)).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(900);
  await expect(page.locator(notice)).toBeVisible();
  await page.clock.runFor(200);
  await expect(page.locator(notice)).toBeHidden();
});

test("a notice stays while it has focus", async ({ page }) => {
  await page.clock.install();
  await reply(page, { type: "done", text: "Done." });
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  await page.locator(notice).focus();
  await page.clock.runFor(3000);
  await expect(page.locator(notice)).toBeVisible();
  await page.locator(notice).blur();
  await page.clock.runFor(1100);
  await expect(page.locator(notice)).toBeHidden();
});

test("a done without a text shows nothing", async ({ page }) => {
  await reply(page, { type: "done" });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(view)).toBeHidden();
  await expect(page.locator(notice)).toBeHidden();
});

test("a stop is a notice that goes away", async ({ page }) => {
  await page.clock.install();
  await reply(page, { type: "stop", text: "Not about this site." });
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  await expect(page.locator(notice)).toHaveText("Not about this site.");
  await expect(page.locator(view)).toBeHidden();
  await page.clock.runFor(1100);
  await expect(page.locator(notice)).toHaveCount(0);
});

test("a long notice stays for its reading time", async ({ page }) => {
  await page.clock.install();
  // 30 words: 10 seconds, longer than notice-duration.
  const text = Array.from({ length: 30 }, () => "word").join(" ");
  await reply(page, { type: "stop", text });
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  await expect(page.locator(notice)).toBeVisible();
  await page.clock.runFor(9900);
  await expect(page.locator(notice)).toBeVisible();
  await page.clock.runFor(200);
  await expect(page.locator(notice)).toHaveCount(0);
});

test("an info keeps its paragraphs and stays until Close", async ({ page }) => {
  await page.clock.install();
  await reply(page, { type: "info", text: "First.\n\nSecond." });
  await openPage(page, '<dicta-action notice-duration="1"></dicta-action>');
  await submit(page, "a");
  const text = page.locator(`${notice} .text`);
  await expect(text).toHaveText("First.\n\nSecond.", { useInnerText: true });
  await expect(text).toHaveCSS("white-space", "pre-line");
  // Only the info string is announced, not the text.
  await expect(page.locator(status)).toHaveText("Working New information");
  await page.clock.runFor(60_000);
  await expect(page.locator(notice)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(notice)).toHaveCount(0);
});

test("texts are shown as plain text", async ({ page }) => {
  await reply(page, { type: "stop", text: "<b>bold</b>" });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(notice)).toHaveText("<b>bold</b>");
});

test("at most three notices, never dropping an info", async ({ page }) => {
  await replies(
    page,
    { type: "info", text: "Help." },
    { type: "stop", text: "One." },
    { type: "stop", text: "Two." },
    { type: "stop", text: "Three." },
  );
  await openPage(page);
  for (const text of ["a", "b", "c", "d"]) {
    await submit(page, text);
    await expect(page.locator('[part~="indicator"]')).toHaveCount(0);
  }
  await expect(page.locator(notice)).toHaveText([
    "Help.Close",
    "Two.",
    "Three.",
  ]);
});

test("a stop stays beside the working view of the next request", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await submit(page, "b");
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "stop", text: "No." } },
  });
  await expect(page.locator('[part~="indicator"]')).toBeVisible();
  await expect(page.locator(notice)).toHaveText("No.");
});

test("an HTTP error shows the error view and logs the cause", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.route(ROUND, (route) =>
    route.fulfill({ status: 400, json: { error: "context: too large" } }),
  );
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(notice)).toHaveText("Something went wrong");
  await expect(page.locator(view)).toBeHidden();
  expect(logs.some((log) => log.includes("HTTP 400: context: too large"))).toBe(
    true,
  );
});

test("strings override the element's own texts", async ({ page }) => {
  let rounds = 0;
  await page.route(ROUND, (route) => {
    rounds += 1;
    return rounds === 1
      ? route.fulfill({ status: 500, json: {} })
      : route.fulfill({
          json: { requestId: "r1", reply: { type: "info", text: "Hilfe." } },
        });
  });
  await openPage(page);
  await page.evaluate(() =>
    Object.assign(document.querySelector("dicta-action")!, {
      strings: {
        error: "Fehler",
        close: "Schliessen",
        unknown: "x",
        cancel: 1,
      },
    }),
  );
  await submit(page, "a");
  await expect(page.locator(notice)).toHaveText("Fehler");
  await submit(page, "b");
  await expect(page.getByRole("button", { name: "Schliessen" })).toBeVisible();
});

test("the page styles a part in one view with the state", async ({ page }) => {
  await reply(page, { type: "question", text: "When?" });
  await openPage(
    page,
    `<style>
      dicta-action:state(question)::part(view) { color: rgb(255, 0, 0); }
      dicta-action:state(working)::part(view) { color: rgb(0, 128, 0); }
    </style>
    <dicta-action></dicta-action>`,
  );
  await submit(page, "a");
  await expect(page.locator(view)).toHaveCSS("color", "rgb(255, 0, 0)");
});

test("the indicator stands still with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator('[part~="indicator"]')).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("the status region announces the outcome", async ({ page }) => {
  await reply(page, { type: "stop", text: "Not about this site." });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(status)).toHaveText("Working Not about this site.");
});

test("the status region announces a notice", async ({ page }) => {
  await reply(page, { type: "done", text: "Moved 2 tasks." });
  await openPage(page);
  await submit(page, "a");
  await expect(page.locator(status)).toHaveText("Working Moved 2 tasks.");
});

test("the focus goes to the element when a stop ends the request", async ({
  page,
}) => {
  const routes = await holdRounds(page);
  await openPage(page);
  await submit(page, "a");
  await page.getByRole("button", { name: "Cancel" }).focus();
  await expect.poll(() => routes.length).toBe(1);
  await routes[0].fulfill({
    json: { requestId: "r1", reply: { type: "stop", text: "No." } },
  });
  await expect(page.locator("dicta-action")).toBeFocused();
});

test("a new view does not take the focus from the page", async ({ page }) => {
  await reply(page, { type: "question", text: "When?" });
  await openPage(page, "<input><dicta-action></dicta-action>");
  await page.locator("input").focus();
  await submit(page, "a");
  await expect(page.locator('[part~="text"]')).toHaveText("When?");
  await expect(page.locator("input")).toBeFocused();
});

// The focus when a view goes away and no view follows (Accessibility).

test("Cancel gives the focus back to the site's text field", async ({
  page,
}) => {
  await holdRounds(page);
  await openPage(page, "<input><dicta-action></dicta-action>");
  await page.locator("input").focus();
  await submit(page, "a");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(view)).toBeHidden();
  await expect(page.locator("input")).toBeFocused();
});

test("Close on an info gives the focus back to the text field", async ({
  page,
}) => {
  await reply(page, { type: "info", text: "Like this." });
  await openPage(page, "<input><dicta-action></dicta-action>");
  await page.locator("input").focus();
  await submit(page, "a");
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  // The info notice first, then its Close.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("input")).toBeFocused();
});

test("the focus goes to the element when the text field is gone", async ({
  page,
}) => {
  await holdRounds(page);
  await openPage(page, "<input><dicta-action></dicta-action>");
  await page.locator("input").focus();
  await submit(page, "a");
  await page.keyboard.press("Tab");
  await page.evaluate(() => document.querySelector("input")?.remove());
  await page.keyboard.press("Enter");
  await expect(page.locator("dicta-action")).toBeFocused();
});

test("a view that goes away without the focus leaves it", async ({ page }) => {
  await holdRounds(page);
  await openPage(
    page,
    "<input><button>Other</button><dicta-action></dicta-action>",
  );
  await page.locator("input").focus();
  await submit(page, "a");
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Other" }).focus();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Other" })).toBeFocused();
});

test("getToken set before the element is defined, and set again", async ({
  page,
}) => {
  const headers: (string | undefined)[] = [];
  await page.route(ROUND, (route) => {
    headers.push(route.request().headers().authorization);
    return route.fulfill({
      json: { requestId: "r1", reply: { type: "done" } },
    });
  });
  // A page without the package yet, so the element is not defined.
  await page.route("**/blank", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>" }),
  );
  await page.goto("/blank");
  await page.evaluate(async () => {
    document.body.innerHTML = "<dicta-action></dicta-action>";
    const element = document.querySelector("dicta-action")!;
    element.setAttribute("server", location.origin);
    Object.assign(element, { getToken: async () => "first" });
    await import("/dist/index.js" as string);
    Object.assign(element, {
      module: {
        site: { name: "Teamboard", desc: "A task list." },
        state: { desc: "The open page.", run: async () => ({}) },
        capabilities: {},
      },
    });
  });
  await submit(page, "a");
  await expect.poll(() => headers).toEqual(["Bearer first"]);
  await page.evaluate(() =>
    Object.assign(document.querySelector("dicta-action")!, {
      getToken: async () => "second",
    }),
  );
  await submit(page, "b");
  await expect.poll(() => headers).toEqual(["Bearer first", "Bearer second"]);
});
