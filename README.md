# Quality Management System

A working starter for managing quality activities in a single-user, local workspace. The dashboard shows open corrective actions, controlled documents, and planned audits. Search and filters help you find records, and forms let you create and update them.

The application includes:

- **Corrective actions:** track the issue, source, severity, owner, due date, and resolution status.
- **Document register:** maintain unique document codes, versions, owners, review dates, and approval status.
- **Audit schedule:** plan audits by area and owner, record findings, and mark progress.
- **Persistent storage:** save records in a local SQLite database, with synthetic example data on first startup.

Document approval is a status in this starter; it does not provide a signed approval workflow or store uploaded document files.

## Run locally

Install **Node.js 24** (the version pinned in `.nvmrc`). Node 24 includes the SQLite support this application uses. There are no third-party runtime packages and no frontend build step.

```sh
npm ci
npm start
```

Open <http://127.0.0.1:3000>. The server prints the address it is listening on. Stop it with `Ctrl+C`.

For development, restart automatically when server files change:

```sh
npm run dev
```

Run the integration tests:

```sh
npm test
```

The tests launch a separate server with a temporary database and check record creation and updates, input validation, static file access, same-origin writes, and persistence after restart. They do not modify your application database.

## Configuration

Set environment variables before starting the server:

| Variable      | Default           | Purpose                                                    |
| ------------- | ----------------- | ---------------------------------------------------------- |
| `HOST`        | `127.0.0.1`       | Interface the server listens on.                           |
| `PORT`        | `3000`            | HTTP port. Use `0` to select an available port.            |
| `QMS_DB_PATH` | `data/qms.sqlite` | SQLite database location.                                  |
| `QMS_SEED`    | enabled           | Set to `false` to start without synthetic example records. |

For a fresh database with no demo records:

```sh
QMS_SEED=false QMS_DB_PATH=data/blank.sqlite npm start
```

Changing `QMS_SEED` does not remove records already saved in a database. The default `data/` directory is ignored by Git so local records are not committed. Keep custom database locations outside tracked repository files.

## Backups and use with real data

Records remain on the machine running the server. To back up the database, stop the application and copy its SQLite files, including any `-wal` and `-shm` sidecar files that are present. For a backup while the application is running, use SQLite's supported backup API or the SQLite command-line `.backup` command instead of copying an active database file. Store backups securely and test restoration to a separate database path.

This starter has no authentication, user roles, or per-user access controls. Use it as a local prototype and keep the default loopback host. Before exposing it to the internet or using confidential quality records, add authentication, authorization, an audit trail, and suitable deployment controls, then review the application for your organization's security and regulatory requirements. Status changes alone do not establish regulatory compliance.

## Project layout

- `server.js` — HTTP API and static file server.
- `db.js` — input validation, SQLite storage, and synthetic sample records.
- `public/` — browser interface, styles, and scripts.
- `test/server.test.js` — HTTP integration tests.
- `data/` — local application data created at runtime.

The JSON API exposes `GET /api/health`, `GET /api/bootstrap`, and `POST`/`PATCH` endpoints for `/api/issues`, `/api/documents`, and `/api/audits`. To edit a record, append its ID to the resource path. This starter does not include record deletion.
