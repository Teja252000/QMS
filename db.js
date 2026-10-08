import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const definitions = {
  issues: {
    title: "text",
    description: "optionalText",
    owner: "text",
    dueDate: "date",
    severity: ["Low", "Medium", "High", "Critical"],
    status: ["Open", "In progress", "Resolved"],
    source: [
      "Internal audit",
      "Customer complaint",
      "Process check",
      "Supplier",
    ],
  },
  documents: {
    title: "text",
    code: "text",
    version: "text",
    owner: "text",
    reviewedAt: "date",
    status: ["Draft", "In review", "Approved"],
  },
  audits: {
    title: "text",
    area: "text",
    owner: "text",
    date: "date",
    status: ["Scheduled", "In progress", "Completed"],
    findings: "integer",
  },
};

const defaults = {
  issues: {
    description: "",
    severity: "Medium",
    status: "Open",
    source: "Internal audit",
  },
  documents: { status: "Draft" },
  audits: { status: "Scheduled", findings: 0 },
};

function validate(kind, body, existing) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Provide a JSON object.");
  }
  const fields = definitions[kind];
  for (const field of Object.keys(body)) {
    if (!Object.hasOwn(fields, field))
      throw new AppError(400, `Unknown field: ${field}.`);
  }
  const result = { ...(existing ?? defaults[kind]), ...body };
  for (const [field, rule] of Object.entries(fields)) {
    const value = result[field];
    if (Array.isArray(rule)) {
      if (!rule.includes(value))
        throw new AppError(400, `${field} must be one of: ${rule.join(", ")}.`);
    } else if (rule === "integer") {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new AppError(400, `${field} must be a nonnegative integer.`);
    } else if (rule === "date") {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new AppError(
          400,
          `${field} must be a date in YYYY-MM-DD format.`,
        );
      }
      const date = new Date(`${value}T00:00:00Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      ) {
        throw new AppError(400, `${field} must be a valid calendar date.`);
      }
    } else {
      if (typeof value !== "string")
        throw new AppError(400, `${field} must be text.`);
      const trimmed = value.trim();
      const max = field === "description" ? 5000 : 200;
      if ((rule === "text" && !trimmed) || trimmed.length > max) {
        throw new AppError(
          400,
          `${field} must contain ${rule === "text" ? "1" : "0"}–${max} characters.`,
        );
      }
      result[field] = trimmed;
    }
  }
  return result;
}

export function openStore(path, { seed = true } = {}) {
  const filename = path === ":memory:" ? path : resolve(path);
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('issues', 'documents', 'audits')),
      payload TEXT NOT NULL CHECK (json_valid(payload))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_codes
    ON records(json_extract(payload, '$.code') COLLATE NOCASE) WHERE kind = 'documents';
  `);
  const selectOne = db.prepare(
    "SELECT payload FROM records WHERE kind = ? AND id = ?",
  );
  const selectAll = db.prepare(
    "SELECT payload FROM records WHERE kind = ? ORDER BY rowid DESC",
  );
  const insert = db.prepare(
    "INSERT INTO records (id, kind, payload) VALUES (?, ?, ?)",
  );
  const update = db.prepare(
    "UPDATE records SET payload = ? WHERE kind = ? AND id = ?",
  );
  function save(kind, body, id) {
    const existing = id ? get(kind, id) : undefined;
    const values = validate(kind, body, existing);
    const now = new Date().toISOString();
    const record = {
      ...values,
      id: id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      if (id) update.run(JSON.stringify(record), kind, id);
      else insert.run(record.id, kind, JSON.stringify(record));
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) {
        throw new AppError(409, "A document with this code already exists.");
      }
      throw error;
    }
    return record;
  }
  function get(kind, id) {
    const row = selectOne.get(kind, id);
    if (!row) throw new AppError(404, "Record not found.");
    return JSON.parse(row.payload);
  }
  const store = {
    create: (kind, body) => save(kind, body),
    patch: (kind, id, body) => save(kind, body, id),
    get,
    list: (kind) => selectAll.all(kind).map((row) => JSON.parse(row.payload)),
    bootstrap: () =>
      Object.fromEntries(
        Object.keys(definitions).map((kind) => [kind, store.list(kind)]),
      ),
    close: () => db.close(),
  };
  if (
    seed &&
    db.prepare("SELECT count(*) AS count FROM records").get().count === 0
  ) {
    db.exec("BEGIN");
    try {
      seedDemo(store);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }
  return store;
}

function seedDemo(store) {
  function day(offset) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  for (const issue of [
    {
      title: "Calibration record missing for inspection gauge",
      description:
        "The incoming inspection gauge is missing its latest calibration record. Verify the gauge, upload the record, and document the root cause and corrective action here.",
      severity: "High",
      status: "Open",
      owner: "Maya Chen",
      dueDate: day(3),
      source: "Internal audit",
    },
    {
      title: "Supplier packaging damaged in transit",
      description:
        "Two cartons arrived with damaged seals. Review handling requirements with the supplier and record corrective action before the next delivery.",
      severity: "Medium",
      status: "In progress",
      owner: "Alex Morgan",
      dueDate: day(-2),
      source: "Supplier",
    },
    {
      title: "Work instruction revision mismatch",
      description:
        "The assembly station referenced an outdated work instruction. Replace the local copy and verify operator acknowledgment.",
      severity: "Medium",
      status: "Open",
      owner: "Sam Rivera",
      dueDate: day(7),
      source: "Process check",
    },
    {
      title: "Customer label discrepancy",
      description:
        "Label template corrected and verification completed. The customer accepted the replacement labels.",
      severity: "Low",
      status: "Resolved",
      owner: "Maya Chen",
      dueDate: day(-5),
      source: "Customer complaint",
    },
  ])
    store.create("issues", issue);
  for (const document of [
    {
      title: "Quality management manual",
      code: "QM-001",
      version: "2.1",
      owner: "Maya Chen",
      status: "Approved",
      reviewedAt: day(-15),
    },
    {
      title: "Incoming inspection procedure",
      code: "SOP-014",
      version: "1.3",
      owner: "Alex Morgan",
      status: "In review",
      reviewedAt: day(-3),
    },
    {
      title: "Corrective action procedure",
      code: "SOP-008",
      version: "3.0",
      owner: "Sam Rivera",
      status: "Approved",
      reviewedAt: day(-9),
    },
    {
      title: "Supplier evaluation checklist",
      code: "FRM-023",
      version: "1.0",
      owner: "Alex Morgan",
      status: "Draft",
      reviewedAt: day(-1),
    },
  ])
    store.create("documents", document);
  for (const audit of [
    {
      title: "Production process review",
      area: "Production",
      owner: "Sam Rivera",
      date: day(5),
      status: "Scheduled",
      findings: 0,
    },
    {
      title: "Supplier quality audit",
      area: "Supply chain",
      owner: "Alex Morgan",
      date: day(12),
      status: "Scheduled",
      findings: 0,
    },
    {
      title: "Document control review",
      area: "Quality assurance",
      owner: "Maya Chen",
      date: day(-4),
      status: "Completed",
      findings: 2,
    },
  ])
    store.create("audits", audit);
}
