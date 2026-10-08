import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { AppError, openStore } from "./db.js";

const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PORT must be an integer between 0 and 65535.");
const store = openStore(
  process.env.QMS_DB_PATH || resolve(root, "data/qms.sqlite"),
  { seed: process.env.QMS_SEED !== "false" },
);
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if (
    !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")
  ) {
    throw new AppError(415, "Use Content-Type: application/json.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024)
      throw new AppError(413, "Request body exceeds 64 KiB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Request body must be valid JSON.");
  }
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  try {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    const method = request.method;
    const actualPort = server.address().port;
    const allowedHosts = new Set([
      `${host}:${actualPort}`,
      `127.0.0.1:${actualPort}`,
      `localhost:${actualPort}`,
    ]);
    if (!allowedHosts.has(request.headers.host))
      throw new AppError(
        403,
        "Unrecognized host. Use the local server address.",
      );
    if (["POST", "PATCH"].includes(method) && request.headers.origin) {
      const allowedOrigins = [...allowedHosts].map(
        (value) => `http://${value}`,
      );
      if (!allowedOrigins.includes(request.headers.origin))
        throw new AppError(403, "Cross-origin writes are not allowed.");
    }
    if (method === "GET" && path === "/api/health")
      return json(response, 200, { status: "ok" });
    if (method === "GET" && path === "/api/bootstrap")
      return json(response, 200, store.bootstrap());
    const match = path.match(
      /^\/api\/(issues|documents|audits)(?:\/([A-Za-z0-9-]+))?$/,
    );
    if (match) {
      const [, kind, id] = match;
      if (method === "GET")
        return json(response, 200, id ? store.get(kind, id) : store.list(kind));
      if (method === "POST" && !id)
        return json(response, 201, store.create(kind, await readBody(request)));
      if (method === "PATCH" && id)
        return json(
          response,
          200,
          store.patch(kind, id, await readBody(request)),
        );
      response.setHeader("Allow", id ? "GET, PATCH" : "GET, POST");
      throw new AppError(405, "Method not allowed.");
    }
    if (Object.hasOwn(staticFiles, path) && ["GET", "HEAD"].includes(method)) {
      const [filename, contentType] = staticFiles[path];
      const content = await readFile(resolve(root, "public", filename));
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      });
      return response.end(method === "HEAD" ? undefined : content);
    }
    throw new AppError(404, "Not found.");
  } catch (error) {
    if (!(error instanceof AppError))
      console.error("Request failed:", error.message);
    if (!response.headersSent)
      json(response, error.status || 500, {
        error:
          error instanceof AppError ? error.message : "Internal server error.",
      });
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  console.log(`QMS listening on http://${host}:${server.address().port}`);
});
server.on("error", (error) => {
  console.error("QMS failed to start:", error.message);
  store.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
