import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { buildContext } from "../src/context.ts";
import type { CapabilityModule } from "../src/index.ts";
import { localTime, RoundClient } from "../src/round.ts";

const module: CapabilityModule = {
  site: { name: "Teamboard", desc: "A task list." },
  state: { desc: "The open page.", run: async () => ({ page: "tasks" }) },
  capabilities: {
    "tasks.list": { level: "read", desc: "Lists tasks.", run: async () => [] },
  },
};

type Call = { url: string; init: RequestInit };

// Replaces fetch with one that answers with the given responses in order.
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const done = () => json(200, { requestId: "r1", reply: { type: "done" } });

function body(call: Call) {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

function header(call: Call, name: string) {
  return (call.init.headers as Record<string, string>)[name];
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

test("a round posts the body and returns the reply", async () => {
  const calls = fakeFetch(
    json(200, { requestId: "r1", reply: { type: "stop", text: "No." } }),
  );
  const client = new RoundClient("https://example.com/some/path", module);
  const result = await client.send({ text: "hi", exchange: [] });

  assert.deepEqual(result, {
    requestId: "r1",
    reply: { type: "stop", text: "No." },
  });
  assert.equal(calls[0].url, "https://example.com/dicta-action/v1/round");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(header(calls[0], "Content-Type"), "application/json");
  assert.equal(header(calls[0], "Authorization"), undefined);
  const sent = body(calls[0]);
  assert.equal(Object.hasOwn(sent, "requestId"), false);
  assert.equal(sent.text, "hi");
  assert.deepEqual(sent.state, { page: "tasks" });
  assert.deepEqual(sent.exchange, []);
  assert.deepEqual(sent.context, buildContext(module));
  assert.match(
    sent.time as string,
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/,
  );
});

test("a later round sends its requestId", async () => {
  const calls = fakeFetch(done());
  const client = new RoundClient("https://example.com", module);
  await client.send({
    requestId: "r1",
    text: "hi",
    exchange: [{ added: "x" }],
  });
  assert.equal(body(calls[0]).requestId, "r1");
  assert.deepEqual(body(calls[0]).exchange, [{ added: "x" }]);
});

test("the token is kept between rounds", async () => {
  const calls = fakeFetch(done(), done());
  let count = 0;
  const client = new RoundClient("https://example.com", module, async () => {
    count += 1;
    return `t${count}`;
  });
  await client.send({ text: "a", exchange: [] });
  await client.send({ text: "b", exchange: [] });
  assert.equal(count, 1);
  assert.equal(header(calls[0], "Authorization"), "Bearer t1");
  assert.equal(header(calls[1], "Authorization"), "Bearer t1");
});

test("a 401 gets a new token and one more try with the same body", async () => {
  const calls = fakeFetch(json(401, { error: "expired" }), done());
  let count = 0;
  const client = new RoundClient("https://example.com", module, async () => {
    count += 1;
    return `t${count}`;
  });
  const result = await client.send({ text: "a", exchange: [] });
  assert.equal(result.reply.type, "done");
  assert.equal(header(calls[1], "Authorization"), "Bearer t2");
  assert.equal(calls[1].init.body, calls[0].init.body);
});

test("a second 401 is an error", async () => {
  fakeFetch(
    json(401, { error: "bad token" }),
    json(401, { error: "bad token" }),
  );
  const client = new RoundClient(
    "https://example.com",
    module,
    async () => "t",
  );
  await assert.rejects(
    client.send({ text: "a", exchange: [] }),
    (err) => err instanceof Error && err.message === "HTTP 401: bad token",
  );
});

test("another HTTP error is an error with the server's error", async () => {
  const calls = fakeFetch(json(400, { error: "context: too large" }));
  const client = new RoundClient(
    "https://example.com",
    module,
    async () => "t",
  );
  await assert.rejects(
    client.send({ text: "a", exchange: [] }),
    (err) =>
      err instanceof Error && err.message === "HTTP 400: context: too large",
  );
  assert.equal(calls.length, 1);
});

test("an HTTP error without a JSON body is an error", async () => {
  fakeFetch(new Response("Bad Gateway", { status: 502 }));
  const client = new RoundClient("https://example.com", module);
  await assert.rejects(client.send({ text: "a", exchange: [] }), {
    message: "HTTP 502",
  });
});

test("a network failure is an error, with no retry", async () => {
  const calls = fakeFetch(new TypeError("Failed to fetch"));
  const client = new RoundClient("https://example.com", module);
  await assert.rejects(
    client.send({ text: "a", exchange: [] }),
    (err) =>
      err instanceof Error &&
      err.message === "network failure: Failed to fetch",
  );
  assert.equal(calls.length, 1);
});

test("no response after 60 seconds is an error", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
  });
  const client = new RoundClient("https://example.com", module);
  const sent = client.send({ text: "a", exchange: [] });
  // Let the state function and the fetch call run before the clock moves.
  await new Promise((resolve) => setImmediate(resolve));
  let settled = false;
  sent.catch(() => {}).finally(() => (settled = true));
  mock.timers.tick(59_999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  mock.timers.tick(1);
  await assert.rejects(sent, {
    message: "no response after 60 seconds",
  });
});

test("an unknown reply type is an error", async () => {
  fakeFetch(json(200, { requestId: "r1", reply: { type: "dance" } }));
  const client = new RoundClient("https://example.com", module);
  await assert.rejects(
    client.send({ text: "a", exchange: [] }),
    (err) =>
      err instanceof Error && err.message === "unknown reply type: dance",
  );
});

test("a response without a reply is an error", async () => {
  fakeFetch(json(200, { requestId: "r1", reply: null }));
  const client = new RoundClient("https://example.com", module);
  await assert.rejects(client.send({ text: "a", exchange: [] }), {
    message: "the response has no requestId or reply",
  });
});

test("getToken throwing is an error", async () => {
  const calls = fakeFetch(done());
  const client = new RoundClient("https://example.com", module, async () => {
    throw new Error("backend down");
  });
  await assert.rejects(
    client.send({ text: "a", exchange: [] }),
    (err) =>
      err instanceof Error && err.message === "getToken failed: backend down",
  );
  assert.equal(calls.length, 0);
});

test("state.run throwing is an error", async () => {
  const calls = fakeFetch(done());
  const broken: CapabilityModule = {
    ...module,
    state: {
      desc: "The open page.",
      run: async () => {
        throw new Error("no page");
      },
    },
  };
  const client = new RoundClient("https://example.com", broken);
  await assert.rejects(
    client.send({ text: "a", exchange: [] }),
    (err) =>
      err instanceof Error && err.message === "state.run failed: no page",
  );
  assert.equal(calls.length, 0);
});

// A date with a chosen offset: getTimezoneOffset is minutes behind UTC.
function at(iso: string, offsetMinutes: number) {
  const date = new Date(iso);
  date.getTimezoneOffset = () => -offsetMinutes;
  return date;
}

test("the time has a positive offset", () => {
  assert.equal(
    localTime(at("2026-10-28T14:20:05Z", 60)),
    "2026-10-28T15:20:05+01:00",
  );
});

test("the time has a negative offset", () => {
  assert.equal(
    localTime(at("2026-10-28T01:20:05Z", -210)),
    "2026-10-27T21:50:05-03:30",
  );
});

test("the time has a zero offset as numbers, never Z", () => {
  assert.equal(
    localTime(at("2026-10-28T14:20:05.900Z", 0)),
    "2026-10-28T14:20:05+00:00",
  );
});
