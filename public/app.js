"use strict";

const state = {
  issues: [],
  documents: [],
  audits: [],
  ready: false,
  filters: {
    issues: { search: "", status: "All statuses" },
    documents: { search: "", status: "All statuses" },
    audits: { search: "", status: "All statuses" },
  },
};
const names = {
  overview: "Overview",
  issues: "Nonconformities",
  documents: "Documents",
  audits: "Audits",
};
const singular = {
  issues: "nonconformity",
  documents: "document",
  audits: "audit",
};
const main = document.querySelector("#main-content");
const dialog = document.querySelector("#record-dialog");
const today = localDate(new Date());
let toastTimer;
let dialogTrigger;

function escapeHtml(value = "") {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}
function icon(name, extraClass = "") {
  return `<svg class="icon ${escapeHtml(extraClass)}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
}
function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateObject(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDate(
  value,
  options = { month: "short", day: "numeric", year: "numeric" },
) {
  const date = dateObject(value);
  return date ? date.toLocaleDateString(undefined, options) : "—";
}
function initials(value) {
  return String(value || "Unassigned")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
function owner(value) {
  return `<span class="owner-cell"><span class="owner-avatar" aria-hidden="true">${escapeHtml(initials(value))}</span>${escapeHtml(value || "Unassigned")}</span>`;
}
function badge(value) {
  const className = String(value).toLowerCase().replace(/\s+/g, "-");
  return `<span class="badge badge-${escapeHtml(className)}">${escapeHtml(value)}</span>`;
}
function severity(value) {
  return `<span class="severity severity-${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;
}
function isActive(issue) {
  return issue.status !== "Resolved";
}
function isOverdue(issue) {
  return isActive(issue) && Boolean(issue.dueDate) && issue.dueDate < today;
}
function isUpcoming(audit) {
  return audit.status !== "Completed" && audit.date >= today;
}
function currentView() {
  return Object.hasOwn(names, location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview";
}
function recordButton(kind, record) {
  return `<button class="record-title" data-action="edit" data-kind="${kind}" data-id="${escapeHtml(record.id)}" aria-label="Edit ${singular[kind]}: ${escapeHtml(record.title)}">${escapeHtml(record.title)}</button>`;
}
function recordCode(record, kind) {
  return escapeHtml(kind === "documents" ? record.code : record.id);
}
function emptyState(kind, filtered = false) {
  const labels = {
    issues: "nonconformities",
    documents: "documents",
    audits: "audits",
  };
  const icons = { issues: "issue", documents: "file", audits: "calendar" };
  return `<div class="empty-state">${icon(icons[kind])}<h3>${filtered ? "No matching records" : `No ${labels[kind]} yet`}</h3><p>${filtered ? "Try a different search or status filter." : `Add your first ${singular[kind]} to get started.`}</p>${filtered ? "" : `<button class="button button-secondary" data-action="create" data-kind="${kind}">${icon("plus")}Add ${singular[kind]}</button>`}</div>`;
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The server returned an unexpected response. Please try again.",
    );
  }
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
async function loadWorkspace() {
  main.innerHTML =
    '<div class="loading-state"><span class="spinner"></span><h1>Opening your workspace</h1><p>Loading issues, documents, and audits.</p></div>';
  const dot = document.querySelector("#connection-dot");
  const label = document.querySelector("#connection-label");
  dot.className = "connection-dot";
  label.textContent = "Connecting…";
  try {
    const data = await request("/api/bootstrap");
    for (const key of ["issues", "documents", "audits"]) {
      if (!Array.isArray(data[key]))
        throw new Error("The workspace data could not be loaded.");
      state[key] = data[key];
    }
    state.ready = true;
    render();
    try {
      const health = await request("/api/health");
      if (health.status !== "ok") throw new Error("Unavailable");
      dot.className = "connection-dot connected";
      label.textContent = "Workspace connected";
    } catch {
      dot.className = "connection-dot disconnected";
      label.textContent = "Health check unavailable";
    }
  } catch (error) {
    state.ready = false;
    dot.className = "connection-dot disconnected";
    label.textContent = "Connection unavailable";
    main.innerHTML = `<div class="error-state"><h1>Unable to open the workspace</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" data-action="retry">Try again</button></div>`;
  }
}
function heading(kind) {
  const info = {
    overview: [
      "YOUR QUALITY WORKSPACE",
      "Quality, in focus.",
      "Keep your process moving. Every issue, document, and audit in one place.",
    ],
    issues: [
      "CONTINUOUS IMPROVEMENT",
      "Nonconformities",
      "Identify issues, track ownership, and follow them through to resolution.",
    ],
    documents: [
      "DOCUMENT CONTROL",
      "Documents",
      "A clear record of your procedures, versions, and approval status.",
    ],
    audits: [
      "ASSURANCE & REVIEW",
      "Audits",
      "Plan your reviews, record findings, and keep your audit program on track.",
    ],
  }[kind];
  const actionKind = kind === "overview" ? "issues" : kind;
  return `<div class="page-heading"><div><p class="eyebrow">${info[0]}</p><h1>${info[1]}</h1><p class="page-subtitle">${info[2]}</p></div><button class="button button-primary" data-action="create" data-kind="${actionKind}">${icon("plus")}New ${singular[actionKind]}</button></div>`;
}
function render() {
  if (!state.ready) return;
  const view = currentView();
  document.title = `${names[view]} · QMS`;
  document.querySelector("#breadcrumb-current").textContent = names[view];
  document.querySelectorAll(".main-nav a").forEach((link) => {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector("#issue-nav-count").textContent =
    state.issues.filter(isActive).length;
  main.innerHTML =
    heading(view) + (view === "overview" ? dashboard() : recordsSection(view));
  if (view !== "overview") renderRecords(view);
}
function metric(title, number, note, iconName, color, kind, filter) {
  return `<button class="metric-card" data-action="navigate" data-kind="${kind}" data-filter="${filter}"><div class="metric-top"><span>${title}</span><span class="metric-icon ${color}">${icon(iconName)}</span></div><div class="metric-value">${number}</div><div class="metric-foot ${color === "orange" && number ? "attention" : ""}">${note}</div></button>`;
}
function dashboard() {
  const active = state.issues.filter(isActive);
  const overdue = state.issues.filter(isOverdue);
  const approved = state.documents.filter(
    (document) => document.status === "Approved",
  );
  const upcoming = state.audits
    .filter(isUpcoming)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = [...state.issues]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 5);
  const resolved = state.issues.filter(
    (issue) => issue.status === "Resolved",
  ).length;
  const rate = state.issues.length
    ? Math.round((resolved / state.issues.length) * 100)
    : 0;
  const needingReview = state.documents.filter(
    (document) => document.status === "In review",
  ).length;
  return `<section class="metric-grid" aria-label="Workspace metrics">
    ${metric("Active nonconformities", active.length, `${state.issues.length} total recorded`, "issue", "", "issues", "Active")}
    ${metric("Overdue actions", overdue.length, overdue.length ? "Due dates need your attention" : "No overdue nonconformities", "clock", "orange", "issues", "Overdue")}
    ${metric("Approved documents", approved.length, `${state.documents.length} controlled documents`, "file", "teal", "documents", "Approved")}
    ${metric("Upcoming audits", upcoming.length, upcoming.length ? `Next: ${formatDate(upcoming[0].date, { month: "short", day: "numeric" })}` : "No upcoming audits scheduled", "calendar", "purple", "audits", "Upcoming")}
  </section>
  <div class="dashboard-grid">
    <section class="card"><div class="card-header"><div><h2>Recent nonconformities</h2><p class="card-description">Your latest issues and their current status</p></div><button class="text-button" data-action="navigate" data-kind="issues">View all ${icon("arrow")}</button></div>${recent.length ? issueTable(recent, true) : emptyState("issues")}<div class="card-footer"><span>${recent.length} of ${state.issues.length} nonconformities</span><span>Updated when you save</span></div></section>
    <section class="card"><div class="card-header"><div><h2>Upcoming audits</h2><p class="card-description">What's next on your calendar</p></div><button class="text-button" data-action="navigate" data-kind="audits" data-filter="Upcoming">View all ${icon("arrow")}</button></div>${upcoming.length ? `<div class="audit-list">${upcoming.slice(0, 3).map(auditPreview).join("")}</div>` : `<div class="empty-state">${icon("calendar")}<h3>Your calendar is clear</h3><p>Schedule an audit to plan your next review.</p><button class="button button-secondary" data-action="create" data-kind="audits">${icon("plus")}Schedule audit</button></div>`}</section>
  </div>
  <div class="dashboard-bottom"><section class="card progress-card"><h2>Continuous improvement</h2><p>Every resolved nonconformity is a step toward a better process.</p><div class="progress-summary"><div class="progress-value">${rate}<small>%</small></div><div class="progress-track-block"><progress class="progress-track" value="${rate}" max="100" aria-label="Nonconformities resolved">${rate}%</progress><div class="progress-caption">${resolved} of ${state.issues.length} nonconformities resolved</div></div></div></section><section class="card insight-card">${icon("check")}<div><h2>${needingReview ? `${needingReview} document${needingReview === 1 ? "" : "s"} ready for review` : "Keep your knowledge up to date"}</h2><p>${needingReview ? "Review your pending documents and update their approval status when ready." : "Document your procedures and review them regularly to keep your team aligned."}</p><button class="text-button" data-action="navigate" data-kind="documents"${needingReview ? ' data-filter="In review"' : ""}>Go to documents ${icon("arrow")}</button></div></section></div>`;
}
function auditPreview(audit) {
  return `<div class="audit-item"><div class="audit-date" aria-hidden="true"><span>${formatDate(audit.date, { month: "short" })}</span><strong>${formatDate(audit.date, { day: "numeric" })}</strong></div><div class="audit-content">${recordButton("audits", audit)}<p class="audit-meta">${escapeHtml(audit.area)} · ${escapeHtml(audit.owner)} · ${formatDate(audit.date, { year: "numeric" })}</p>${badge(audit.status)}</div></div>`;
}
function recordsSection(kind) {
  const statuses = {
    issues: [
      "All statuses",
      "Active",
      "Overdue",
      "Open",
      "In progress",
      "Resolved",
    ],
    documents: ["All statuses", "Draft", "In review", "Approved"],
    audits: [
      "All statuses",
      "Upcoming",
      "Scheduled",
      "In progress",
      "Completed",
    ],
  }[kind];
  const filter = state.filters[kind];
  return `<section class="card section-card" aria-label="${names[kind]} records"><div class="section-toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="record-search">Search ${names[kind].toLowerCase()}</label><input id="record-search" type="search" placeholder="Search ${names[kind].toLowerCase()}…" value="${escapeHtml(filter.search)}" autocomplete="off" /></div><div class="toolbar-filters"><label for="status-filter">Status</label><select id="status-filter">${statuses.map((status) => `<option${status === filter.status ? " selected" : ""}>${status}</option>`).join("")}</select></div></div><div id="record-list"></div><div class="card-footer"><span id="record-count"></span><span>Select a record to edit</span></div></section>`;
}
function filteredRecords(kind) {
  const { search, status } = state.filters[kind];
  const query = search.trim().toLowerCase();
  return state[kind]
    .filter((record) => {
      const matchesSearch = [
        record.title,
        record.id,
        record.owner,
        record.code,
        record.area,
        record.source,
        record.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
      const matchesStatus =
        status === "All statuses" ||
        (status === "Active"
          ? isActive(record)
          : status === "Overdue"
            ? isOverdue(record)
            : status === "Upcoming"
              ? isUpcoming(record)
              : record.status === status);
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) =>
      kind === "audits"
        ? a.date.localeCompare(b.date)
        : String(b.createdAt).localeCompare(String(a.createdAt)),
    );
}
function renderRecords(kind) {
  const list = document.querySelector("#record-list");
  if (!list) return;
  const records = filteredRecords(kind);
  const isFiltered = Boolean(
    state.filters[kind].search || state.filters[kind].status !== "All statuses",
  );
  list.innerHTML = records.length
    ? { issues: issueTable, documents: documentTable, audits: auditTable }[
        kind
      ](records)
    : emptyState(kind, isFiltered);
  document.querySelector("#record-count").textContent =
    `${records.length} of ${state[kind].length} ${names[kind].toLowerCase()}`;
}
function issueTable(records, compact = false) {
  return `<div class="table-scroll"><table><thead><tr><th scope="col">Nonconformity</th><th scope="col">Severity</th><th scope="col">Status</th>${compact ? "" : '<th scope="col">Owner</th><th scope="col">Due date</th><th scope="col">Source</th>'}</tr></thead><tbody>${records.map((record) => `<tr><td>${recordButton("issues", record)}<span class="record-code">${recordCode(record, "issues")}</span></td><td>${severity(record.severity)}</td><td>${badge(record.status)}</td>${compact ? "" : `<td>${owner(record.owner)}</td><td${isOverdue(record) ? ' class="overdue-date"' : ""}>${formatDate(record.dueDate)}${isOverdue(record) ? '<span class="record-code overdue-date">Overdue</span>' : ""}</td><td>${escapeHtml(record.source)}</td>`}</tr>`).join("")}</tbody></table></div>`;
}
function documentTable(records) {
  return `<div class="table-scroll"><table><thead><tr><th scope="col">Document</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Review date</th></tr></thead><tbody>${records.map((record) => `<tr><td>${recordButton("documents", record)}<span class="record-code">${recordCode(record, "documents")}</span></td><td>v${escapeHtml(record.version)}</td><td>${badge(record.status)}</td><td>${owner(record.owner)}</td><td>${formatDate(record.reviewedAt)}</td></tr>`).join("")}</tbody></table></div>`;
}
function auditTable(records) {
  return `<div class="table-scroll"><table><thead><tr><th scope="col">Audit</th><th scope="col">Area</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Date</th><th scope="col">Findings</th></tr></thead><tbody>${records.map((record) => `<tr><td>${recordButton("audits", record)}<span class="record-code">${recordCode(record, "audits")}</span></td><td>${escapeHtml(record.area)}</td><td>${badge(record.status)}</td><td>${owner(record.owner)}</td><td>${formatDate(record.date)}</td><td>${escapeHtml(record.findings)}</td></tr>`).join("")}</tbody></table></div>`;
}
function field(name, label, value, options = {}) {
  const {
    type = "text",
    required = true,
    full = false,
    choices,
    help,
    placeholder = "",
    maxLength = 200,
  } = options;
  const id = `field-${name}`;
  const attributes = `id="${id}" name="${name}"${required ? " required" : ""}${help ? ` aria-describedby="${id}-help"` : ""}`;
  let control;
  if (choices)
    control = `<select ${attributes}>${choices.map((choice) => `<option${choice === value ? " selected" : ""}>${escapeHtml(choice)}</option>`).join("")}</select>`;
  else if (type === "textarea")
    control = `<textarea ${attributes} maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`;
  else
    control = `<input ${attributes} type="${type}" value="${escapeHtml(value)}"${type === "number" ? ' min="0" max="1000000" step="1"' : type === "date" ? ' min="1900-01-01" max="9999-12-31"' : ` maxlength="${maxLength}"`} placeholder="${escapeHtml(placeholder)}" />`;
  return `<div class="form-field${full ? " full" : ""}"><label for="${id}">${label}${required ? '<span class="required" aria-hidden="true">*</span>' : ""}</label>${control}${help ? `<span class="field-help" id="${id}-help">${help}</span>` : ""}</div>`;
}
function openForm(kind, id, trigger) {
  if (!Object.hasOwn(singular, kind)) return;
  const record = id ? state[kind].find((item) => item.id === id) : null;
  if (id && !record) return;
  const editing = Boolean(record);
  const value = (key, fallback = "") => record?.[key] ?? fallback;
  let fields;
  if (kind === "issues") {
    fields =
      field("title", "Issue title", value("title"), {
        full: true,
        placeholder: "Describe the nonconformity",
      }) +
      field("description", "Description", value("description"), {
        type: "textarea",
        required: false,
        full: true,
        maxLength: 5000,
        placeholder:
          "What happened? Include context and any corrective actions.",
      }) +
      field("severity", "Severity", value("severity", "Medium"), {
        choices: ["Low", "Medium", "High", "Critical"],
      }) +
      field("status", "Status", value("status", "Open"), {
        choices: ["Open", "In progress", "Resolved"],
      }) +
      field("owner", "Owner", value("owner"), {
        placeholder: "Responsible person",
      }) +
      field("dueDate", "Due date", value("dueDate", today), { type: "date" }) +
      field("source", "Source", value("source", "Internal audit"), {
        full: true,
        choices: [
          "Internal audit",
          "Customer complaint",
          "Process check",
          "Supplier",
        ],
      });
  } else if (kind === "documents") {
    fields =
      field("title", "Document title", value("title"), {
        full: true,
        placeholder: "e.g. Document control procedure",
      }) +
      field("code", "Document code", value("code"), {
        placeholder: "e.g. SOP-001",
        maxLength: 80,
      }) +
      field("version", "Version", value("version", "1.0"), {
        placeholder: "e.g. 1.0",
        maxLength: 30,
      }) +
      field("owner", "Owner", value("owner"), {
        placeholder: "Responsible person",
      }) +
      field("status", "Approval status", value("status", "Draft"), {
        choices: ["Draft", "In review", "Approved"],
      }) +
      field("reviewedAt", "Review date", value("reviewedAt", today), {
        type: "date",
        full: true,
        help: "Record the date of the document's latest review.",
      });
  } else {
    fields =
      field("title", "Audit title", value("title"), {
        full: true,
        placeholder: "e.g. Quarterly process audit",
      }) +
      field("area", "Area / department", value("area"), {
        placeholder: "e.g. Operations",
      }) +
      field("owner", "Audit owner", value("owner"), {
        placeholder: "Responsible person",
      }) +
      field("date", "Audit date", value("date", today), { type: "date" }) +
      field("status", "Status", value("status", "Scheduled"), {
        choices: ["Scheduled", "In progress", "Completed"],
      }) +
      field("findings", "Number of findings", value("findings", 0), {
        type: "number",
        full: true,
        help: "Update the number as audit findings are recorded.",
      });
  }
  const context = editing
    ? `${recordCode(record, kind)} · Update the details and status below.`
    : `Add a ${singular[kind]} to your quality workspace.`;
  document.querySelector("#dialog-content").innerHTML =
    `<div class="dialog-header"><div><h2 id="dialog-title">${editing ? "Edit" : "New"} ${singular[kind]}</h2><p>${context}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon("close")}</button></div><form class="record-form" data-kind="${kind}"${editing ? ` data-id="${escapeHtml(record.id)}"` : ""}><div class="form-grid">${fields}</div><div id="form-error" class="form-error" role="alert"></div><div class="dialog-actions"><span class="dialog-actions-note">* Required fields<br />Changes are saved in this workspace.</span><div class="dialog-action-buttons"><button class="button button-secondary" type="button" data-action="close-dialog">Cancel</button><button class="button button-primary" type="submit">${editing ? "Save changes" : `Create ${singular[kind]}`}</button></div></div></form>`;
  dialogTrigger = trigger;
  dialog.showModal();
}
function notify(message, error = false) {
  clearTimeout(toastTimer);
  const region = document.querySelector("#toast-region");
  region.innerHTML = `<div class="toast${error ? " error" : ""}">${icon(error ? "issue" : "check")}${escapeHtml(message)}</div>`;
  toastTimer = setTimeout(() => {
    region.innerHTML = "";
  }, 4500);
}
async function saveRecord(event) {
  const form = event.target;
  if (!form.matches(".record-form")) return;
  event.preventDefault();
  const kind = form.dataset.kind;
  const id = form.dataset.id;
  const payload = Object.fromEntries(new FormData(form));
  for (const key of Object.keys(payload))
    if (typeof payload[key] === "string") payload[key] = payload[key].trim();
  if (kind === "audits") payload.findings = Number(payload.findings);
  const submit = form.querySelector('[type="submit"]');
  const errorBox = form.querySelector("#form-error");
  const originalText = submit.textContent;
  errorBox.textContent = "";
  submit.disabled = true;
  submit.textContent = "Saving…";
  // Keep the form open during a save so a pending result cannot replace another dialog.
  form.querySelectorAll('[data-action="close-dialog"]').forEach((button) => {
    button.disabled = true;
  });
  dialog.querySelector(".icon-button").disabled = true;
  dialog.dataset.saving = "true";
  try {
    const saved = await request(
      `/api/${kind}${id ? `/${encodeURIComponent(id)}` : ""}`,
      { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) },
    );
    if (id)
      state[kind] = state[kind].map((item) => (item.id === id ? saved : item));
    else state[kind].push(saved);
    dialog.close();
    render();
    notify(
      `${singular[kind][0].toUpperCase()}${singular[kind].slice(1)} ${id ? "updated" : "created"}.`,
    );
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.scrollIntoView({ block: "nearest" });
  } finally {
    delete dialog.dataset.saving;
    submit.disabled = false;
    submit.textContent = originalText;
    form.querySelectorAll('[data-action="close-dialog"]').forEach((button) => {
      button.disabled = false;
    });
    dialog.querySelector(".icon-button").disabled = false;
  }
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const { action, kind, id, filter } = button.dataset;
  if (action === "create" || action === "edit")
    openForm(kind, action === "edit" ? id : undefined, button);
  else if (action === "close-dialog" && !dialog.dataset.saving) dialog.close();
  else if (action === "retry") loadWorkspace();
  else if (action === "navigate" && Object.hasOwn(state.filters, kind)) {
    state.filters[kind] = { search: "", status: filter || "All statuses" };
    if (location.hash === `#${kind}`) render();
    else location.hash = kind;
  }
});
main.addEventListener("input", (event) => {
  if (event.target.id === "record-search") {
    const view = currentView();
    state.filters[view].search = event.target.value;
    renderRecords(view);
  }
});
main.addEventListener("change", (event) => {
  if (event.target.id === "status-filter") {
    const view = currentView();
    state.filters[view].status = event.target.value;
    renderRecords(view);
  }
});
dialog.addEventListener("submit", saveRecord);
dialog.addEventListener("cancel", (event) => {
  if (dialog.dataset.saving) event.preventDefault();
});
dialog.addEventListener("close", () => {
  if (dialogTrigger?.isConnected) dialogTrigger.focus();
  else main.focus({ preventScroll: true });
});
window.addEventListener("hashchange", () => {
  render();
});
document.querySelector("#today-label").textContent =
  new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
document.querySelector("#today-label").dateTime = today;
loadWorkspace();
