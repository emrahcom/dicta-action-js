// Opens the test server's page (server.ts), which loads the built module, puts
// the given markup into its body and gives each <dicta-action> a small module
// with tasks.list, tasks.get and tasks.delete
// and, unless set, this page's origin as its server.
// The server's responses are faked with reply().

import type { Page, Route } from "@playwright/test";

export const ROUND = "**/dicta-action/v1/round";

export async function openPage(
  page: Page,
  body = "<dicta-action></dicta-action>",
) {
  await page.goto("/");
  await page.waitForFunction(() => customElements.get("dicta-action"));
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    for (const element of document.querySelectorAll("dicta-action")) {
      if (!element.hasAttribute("server")) {
        element.setAttribute("server", location.origin);
      }
      Object.assign(element, {
        module: {
          site: { name: "Teamboard", desc: "A task list." },
          state: { desc: "The open page.", run: async () => ({ page: "a" }) },
          capabilities: {
            "tasks.delete": {
              level: "destructive",
              desc: "Deletes a task.",
              args: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              confirm: async ({ id }: { id: string }) => `Delete task ${id}`,
              run: async ({ id }: { id: string }) => {
                (window as unknown as { deleted: string[] }).deleted ??= [];
                (window as unknown as { deleted: string[] }).deleted.push(id);
                return { id };
              },
            },
            "tasks.list": {
              level: "read",
              desc: "Lists the tasks.",
              output: { type: "array" },
              run: async () => [
                { id: "t1", title: "Budget" },
                { id: "t2", title: "Review" },
              ],
            },
            "tasks.get": {
              level: "read",
              desc: "Returns a task.",
              args: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              run: async ({ id }: { id: string }) => {
                if (id !== "t1") {
                  throw Object.assign(new Error("No such task"), {
                    code: "not_found",
                  });
                }
                return { id, title: "Budget" };
              },
            },
          },
        },
      });
    }
  }, body);
}

// Answers every round with the given reply.
export async function reply(page: Page, reply: unknown) {
  await page.route(ROUND, (route) =>
    route.fulfill({ json: { requestId: "r1", reply } }),
  );
}

// Holds every round until the test answers it.
export async function holdRounds(page: Page) {
  const routes: Route[] = [];
  await page.route(ROUND, (route) => {
    routes.push(route);
  });
  return routes;
}

export function submit(page: Page, text: string) {
  return page.evaluate(
    (value) =>
      (
        document.querySelector("dicta-action") as unknown as {
          submit(text: string): void;
        }
      ).submit(value),
    text,
  );
}

// Answers the rounds with the given replies in order, and records each body.
export async function replies(page: Page, ...list: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  await page.route(ROUND, (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const reply = list.shift() ?? { type: "stop", text: "No more replies." };
    return route.fulfill({ json: { requestId: "r1", reply } });
  });
  return bodies;
}

// The ids tasks.delete was called with.
export function deleted(page: Page) {
  return page.evaluate(
    () => (window as unknown as { deleted?: string[] }).deleted ?? [],
  );
}
