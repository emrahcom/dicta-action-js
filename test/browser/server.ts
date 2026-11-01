// A small web server for the browser tests: an empty page that loads the built
// module, and the files in dist/. Playwright starts it (playwright.config.ts).
// The tests fake the dicta-action-server's responses in the page.

import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const PORT = 4174; // also in playwright.config.ts

const DIST = new URL("../../dist/", import.meta.url);
const PAGE = `<!doctype html>
<meta charset="utf-8">
<script type="module" src="/dist/index.js"></script>
<body></body>`;

// A page that sets up the element and its module itself, as a site does, so
// it survives page loads. page.reload loads the page again.
const APP_PAGE = `<!doctype html>
<meta charset="utf-8">
<dicta-action></dicta-action>
<script type="module">
  import { dictaCapabilities } from "/dist/index.js";
  const element = document.querySelector("dicta-action");
  element.setAttribute("server", location.origin);
  element.module = {
    site: { name: "Teamboard", desc: "A task list." },
    state: { desc: "The open page.", run: async () => ({ page: "app" }) },
    capabilities: {
      ...dictaCapabilities,
      "tasks.list": {
        level: "read",
        desc: "Lists the tasks.",
        run: async () => [{ id: "t1" }, { id: "t2" }],
      },
      "tasks.delete": {
        level: "destructive",
        desc: "Deletes a task.",
        args: { type: "object", properties: { id: { type: "string" } } },
        confirm: async ({ id }) => "Delete task " + id,
        run: async ({ id }) => ({ id }),
      },
      "page.reload": {
        level: "write",
        desc: "Loads the page again; steps after it do not run.",
        pageLoad: true,
        args: { type: "object", properties: { id: { type: "string" } } },
        run: async () => {
          location.reload();
        },
      },
      // Waits for window.release() before it loads the page again.
      "page.reloadLater": {
        level: "write",
        desc: "Loads the page again later; steps after it do not run.",
        pageLoad: true,
        run: async () => {
          await new Promise((resolve) => (window.release = resolve));
          location.reload();
        },
      },
      // Loads the page again without saying it may.
      "page.reloadUnmarked": {
        level: "write",
        desc: "Loads the page again.",
        run: async () => {
          location.reload();
        },
      },
      // May load a page, but does not.
      "page.stay": {
        level: "read",
        desc: "May load a page.",
        pageLoad: true,
        run: async () => ({}),
      },
      // Saves a file from a Blob.
      "file.save": {
        level: "read",
        desc: "Saves the tasks as a file.",
        run: async () => {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob(["t1,t2"]));
          link.download = "tasks.csv";
          link.click();
          return { name: "tasks.csv" };
        },
      },
      "page.hash": {
        level: "write",
        desc: "Changes the hash.",
        run: async () => {
          location.hash = "#top";
        },
      },
    },
  };
  // Set last, as a site may: a request that goes on still sends the token.
  element.getToken = async () => "app-token";
</script>`;

async function handle(request: IncomingMessage, response: ServerResponse) {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  try {
    if (pathname === "/" || pathname === "/app") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(pathname === "/" ? PAGE : APP_PAGE);
    } else if (pathname.startsWith("/dist/") && !pathname.includes("..")) {
      const file = await readFile(new URL(pathname.slice(6), DIST));
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(file);
    } else {
      response.writeHead(404).end();
    }
  } catch {
    response.writeHead(404).end();
  }
}

createServer((request, response) => void handle(request, response)).listen(
  PORT,
);
