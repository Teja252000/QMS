import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
let directory;
let server;
let baseUrl;

async function startServer() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      QMS_DB_PATH: path.join(directory, "test.sqlite"),
      QMS_SEED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  baseUrl = await new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => {
      server.kill("SIGKILL");
      reject(new Error(`Server startup timed out. ${errors}`));
    }, 10_000);
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    server.once("error", fail);
    server.once("exit", (code) =>
      fail(new Error(`Server exited (${code}). ${errors}`)),
    );
    server.stderr.on("data", (chunk) => {
      errors += chunk.toString();
    });
    server.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(
        /QMS listening on (http:\/\/127\.0\.0\.1:\d+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => server.kill("SIGKILL"), 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function request(route, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers:
      body === undefined
        ? headers
        : { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}

const issue = (overrides = {}) => ({
  title: "Investigate calibration mismatch",
  owner: "Alex Morgan",
  dueDate: "2028-02-29",
  ...overrides,
});
const document = (overrides = {}) => ({
  title: "Calibration procedure",
  code: "SOP-CAL-001",
  version: "1.0",
  owner: "Alex Morgan",
  reviewedAt: "2028-02-29",
  ...overrides,
});
const audit = (overrides = {}) => ({
  title: "Quarterly calibration audit",
  area: "Production",
  owner: "Alex Morgan",
  date: "2028-02-29",
  ...overrides,
});

describe("QMS HTTP integration", { concurrency: false }, () => {
  before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "qms-test-"));
    await startServer();
  });

  after(async () => {
    await stopServer();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test("health is ready and seeding can be disabled", async () => {
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { status: "ok" });
    const result = await request("/api/bootstrap");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { issues: [], documents: [], audits: [] });
  });

  test("serves the application without exposing server code or database files", async () => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      page.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.match(await page.text(), /<!doctype html>/i);
    for (const route of [
      "/server.js",
      "/package.json",
      "/data/qms.sqlite",
      "/%2e%2e%2fserver.js",
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 404, route);
    }
  });

  test("creates and partially updates a corrective action issue", async () => {
    const created = await request("/api/issues", {
      method: "POST",
      body: issue(),
    });
    assert.equal(created.status, 201);
    assert.match(created.data.id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.data.status, "Open");
    assert.equal(created.data.severity, "Medium");
    assert.equal(created.data.source, "Internal audit");
    assert.equal(created.data.description, "");
    assert.ok(Number.isFinite(Date.parse(created.data.createdAt)));
    assert.ok(Number.isFinite(Date.parse(created.data.updatedAt)));

    const updated = await request(`/api/issues/${created.data.id}`, {
      method: "PATCH",
      body: { status: "Resolved", description: "Recalibrated and verified." },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.status, "Resolved");
    assert.equal(updated.data.description, "Recalibrated and verified.");
    assert.equal(updated.data.title, created.data.title);
    assert.equal(updated.data.owner, created.data.owner);
    assert.equal(updated.data.createdAt, created.data.createdAt);

    const { data } = await request("/api/bootstrap");
    assert.deepEqual(
      data.issues.find((item) => item.id === created.data.id),
      updated.data,
    );
  });

  test("creates and updates a controlled document", async () => {
    const created = await request("/api/documents", {
      method: "POST",
      body: document(),
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, "Draft");
    const updated = await request(`/api/documents/${created.data.id}`, {
      method: "PATCH",
      body: { status: "Approved", version: "1.1" },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.status, "Approved");
    assert.equal(updated.data.version, "1.1");
    assert.equal(updated.data.code, created.data.code);
    const { data } = await request("/api/bootstrap");
    assert.deepEqual(
      data.documents.find((item) => item.id === created.data.id),
      updated.data,
    );
  });

  test("creates an audit and records its findings", async () => {
    const created = await request("/api/audits", {
      method: "POST",
      body: audit(),
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, "Scheduled");
    assert.equal(created.data.findings, 0);
    const updated = await request(`/api/audits/${created.data.id}`, {
      method: "PATCH",
      body: { status: "Completed", findings: 3 },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.findings, 3);
    assert.equal(updated.data.status, "Completed");
    assert.equal(updated.data.area, created.data.area);
    const { data } = await request("/api/bootstrap");
    assert.deepEqual(
      data.audits.find((item) => item.id === created.data.id),
      updated.data,
    );
  });

  test("rejects missing required values, unknown fields, and invalid enums", async () => {
    const invalid = [
      ["/api/issues", issue({ title: "" })],
      ["/api/issues", issue({ owner: "  " })],
      ["/api/issues", issue({ severity: "Urgent" })],
      ["/api/issues", issue({ status: "Closed" })],
      ["/api/issues", issue({ source: "Unknown" })],
      ["/api/issues", issue({ unexpected: true })],
      ["/api/documents", document({ code: "" })],
      ["/api/documents", document({ version: "" })],
      ["/api/documents", document({ status: "Published" })],
      ["/api/audits", audit({ area: "" })],
      ["/api/audits", audit({ status: "Cancelled" })],
      ["/api/audits", audit({ findings: -1 })],
      ["/api/audits", audit({ findings: 1.5 })],
      ["/api/audits", audit({ findings: "3" })],
    ];
    for (const [route, body] of invalid) {
      const result = await request(route, { method: "POST", body });
      assert.equal(result.status, 400, `${route}: ${JSON.stringify(body)}`);
      assert.equal(typeof result.data.error, "string");
    }
  });

  test("validates real calendar dates for every record type", async () => {
    for (const invalidDate of [
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "02/28/2026",
      "2026-2-01",
    ]) {
      for (const [route, body] of [
        ["/api/issues", issue({ dueDate: invalidDate })],
        [
          "/api/documents",
          document({ code: `INVALID-${invalidDate}`, reviewedAt: invalidDate }),
        ],
        ["/api/audits", audit({ date: invalidDate })],
      ]) {
        const result = await request(route, { method: "POST", body });
        assert.equal(result.status, 400, `${route}: ${invalidDate}`);
      }
    }
  });

  test("preserves existing data when a partial update is invalid", async () => {
    const created = await request("/api/issues", {
      method: "POST",
      body: issue({ title: "Unchanged record" }),
    });
    for (const body of [
      { dueDate: "2026-02-29" },
      { status: "Closed" },
      { id: "replacement" },
    ]) {
      const updated = await request(`/api/issues/${created.data.id}`, {
        method: "PATCH",
        body,
      });
      assert.equal(updated.status, 400);
    }
    const { data } = await request("/api/bootstrap");
    assert.deepEqual(
      data.issues.find((item) => item.id === created.data.id),
      created.data,
    );
  });

  test("enforces unique document codes on creation and edits", async () => {
    const first = await request("/api/documents", {
      method: "POST",
      body: document({ code: "SOP-UNIQUE-A" }),
    });
    const second = await request("/api/documents", {
      method: "POST",
      body: document({ code: "SOP-UNIQUE-B" }),
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const duplicate = await request("/api/documents", {
      method: "POST",
      body: document({ code: "SOP-UNIQUE-A" }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(typeof duplicate.data.error, "string");
    const caseDuplicate = await request("/api/documents", {
      method: "POST",
      body: document({ code: "sop-unique-a" }),
    });
    assert.equal(caseDuplicate.status, 409);
    const collision = await request(`/api/documents/${second.data.id}`, {
      method: "PATCH",
      body: { code: "SOP-UNIQUE-A" },
    });
    assert.equal(collision.status, 409);
    const unchangedCode = await request(`/api/documents/${first.data.id}`, {
      method: "PATCH",
      body: { code: "SOP-UNIQUE-A", version: "2.0" },
    });
    assert.equal(unchangedCode.status, 200);
  });

  test("returns 404 for a missing record", async () => {
    for (const route of ["issues", "documents", "audits"]) {
      const result = await request(
        `/api/${route}/00000000-0000-0000-0000-000000000000`,
        {
          method: "PATCH",
          body: { title: "Missing" },
        },
      );
      assert.equal(result.status, 404);
      assert.equal(typeof result.data.error, "string");
    }
  });

  test("rejects malformed JSON and oversized request bodies", async () => {
    const malformed = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    const oversized = await request("/api/issues", {
      method: "POST",
      body: issue({ description: "a".repeat(65_537) }),
    });
    assert.equal(oversized.status, 413);
  });

  test("requires a JSON object and does not support record deletion", async () => {
    for (const body of [null, [], "a string"]) {
      const result = await request("/api/issues", { method: "POST", body });
      assert.equal(result.status, 400);
    }
    const wrongType = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(issue()),
    });
    assert.equal(wrongType.status, 415);
    const created = await request("/api/issues", {
      method: "POST",
      body: issue(),
    });
    const deletion = await request(`/api/issues/${created.data.id}`, {
      method: "DELETE",
    });
    assert.equal(deletion.status, 405);
    const { data } = await request("/api/bootstrap");
    assert.ok(data.issues.some((item) => item.id === created.data.id));
  });

  test("rejects writes from a foreign origin and accepts this application origin", async () => {
    const denied = await request("/api/issues", {
      method: "POST",
      body: issue(),
      headers: { Origin: "https://unrelated.example" },
    });
    assert.equal(denied.status, 403);
    const accepted = await request("/api/issues", {
      method: "POST",
      body: issue({ title: "Same-origin creation" }),
      headers: { Origin: baseUrl },
    });
    assert.equal(accepted.status, 201);
  });

  test("rejects an unrecognized Host header", async () => {
    const status = await new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `${baseUrl}/api/health`,
        {
          headers: { Host: "unrelated.example" },
        },
        (response) => {
          response.once("error", reject);
          response.once("end", () => resolve(response.statusCode));
          response.resume();
        },
      );
      outgoing.once("error", reject);
      outgoing.end();
    });
    assert.equal(status, 403);
  });

  test("persists all record types across a server restart", async () => {
    const beforeRestart = await request("/api/bootstrap");
    assert.ok(beforeRestart.data.issues.length > 0);
    assert.ok(beforeRestart.data.documents.length > 0);
    assert.ok(beforeRestart.data.audits.length > 0);
    await stopServer();
    await startServer();
    const afterRestart = await request("/api/bootstrap");
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(afterRestart.data, beforeRestart.data);
  });
});
