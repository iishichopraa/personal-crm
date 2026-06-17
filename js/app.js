const content = document.getElementById("content");
const pageTitle = document.getElementById("page-title");
const topbarActions = document.getElementById("topbar-actions");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalForm = document.getElementById("modal-form");

let currentView = "dashboard";
let modalCallback = null;

const TITLES = {
  dashboard: "Dashboard",
  search: "Search",
  contacts: "My contacts",
  deals: "Deals",
  tasks: "Tasks",
  transcripts: "Call priorities",
  linkedin: "LinkedIn",
  companies: "Companies",
  reports: "Reports",
  settings: "Settings",
  team: "Team overview",
};

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.view));
});

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);
modalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (modalCallback) modalCallback(new FormData(modalForm));
});

function navigate(view) {
  if (typeof canAccessView === "function" && !canAccessView(view)) return;
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  pageTitle.textContent = TITLES[view] || view;
  renderView();
}

async function renderView() {
  if (typeof canAccessView === "function" && !canAccessView(currentView)) {
    currentView = "dashboard";
    pageTitle.textContent = TITLES.dashboard;
  }
  content.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  topbarActions.innerHTML = "";
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.getAll("process_linkedin").length && getSession()?.access_token) {
      await processLinkedInFromUrl();
      return;
    }
    switch (currentView) {
      case "dashboard": await renderDashboard(); break;
      case "search": await renderSearch(); break;
      case "contacts": await renderContacts(); break;
      case "companies": await renderCompanies(); break;
      case "deals": await renderDealsPipeline(); break;
      case "tasks": await renderTasks(); break;
      case "transcripts": await renderTranscripts(); break;
      case "linkedin": await renderLinkedIn(); break;
      case "reports":
        if (typeof renderReports !== "function") throw new Error("Reports module missing — hard refresh the page (Cmd+Shift+R)");
        await renderReports();
        break;
      case "settings": await renderSettings(); break;
      case "team": await renderTeam(); break;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p class="auth-error">Could not load this page: ${escapeHtml(err.message || String(err))}</p><button class="btn btn-primary btn-sm" style="margin-top:1rem" onclick="location.reload()">Reload</button></div>`;
  }
}

function closeModal() {
  modal.close();
  modalCallback = null;
}

function openModal(title, html, onSubmit) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalCallback = onSubmit;
  modal.showModal();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function btn(label, className, onclick) {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onclick);
  return b;
}

function viewingLabel() {
  if (getViewingUserId() === getSession()?.user?.id) return "";
  const m = getMembers().find((x) => x.id === getViewingUserId());
  return m ? ` — ${m.full_name}'s workspace` : "";
}

function readOnlyBanner() {
  if (canEdit()) return "";
  return `<div class="readonly-banner">View-only — you're viewing another team member's workspace</div>`;
}

// ── Dashboard ──

async function renderDashboard() {
  const [contacts, teamDirectory, deals, tasks] = await Promise.all([
    contactsDB.all(),
    directoryDB.all(),
    dealsDB.all(),
    tasksDB.all(),
  ]);
  const contactMap = Object.fromEntries([...teamDirectory.map((p) => [p.id, p]), ...contacts.map((c) => [c.id, c])]);
  const openDeals = deals.filter((d) => !getStageMeta(d.stage)?.is_closed);
  const pipelineValue = openDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const wonValue = deals.filter((d) => getStageMeta(d.stage)?.is_won).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const staleDeals = openDeals.filter(isDealStale);
  const pendingTasks = tasks.filter((t) => !t.done);
  const overdueTasks = pendingTasks.filter((t) => isOverdue(t.dueDate));
  const todayTasks = pendingTasks.filter((t) => isToday(t.dueDate));
  const todayAll = [...todayTasks, ...overdueTasks];
  const sortedTasks = [...pendingTasks].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  content.innerHTML = `
    ${readOnlyBanner()}
    <div class="today-banner">
      <strong>Today's focus</strong> — ${todayAll.length} action${todayAll.length === 1 ? "" : "s"} due${staleDeals.length ? ` · ${staleDeals.length} stale deal${staleDeals.length === 1 ? "" : "s"}` : ""}
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Directory</div><div class="value">${teamDirectory.length.toLocaleString()}</div><div class="sub">${contacts.length} in your CRM · <button type="button" class="link-btn" id="dash-search">Search</button></div></div>
      <div class="stat-card"><div class="label">Open deals</div><div class="value">${openDeals.length}</div><div class="sub">${formatCurrency(pipelineValue)} pipeline</div></div>
      <div class="stat-card"><div class="label">Won revenue</div><div class="value">${formatCurrency(wonValue)}</div></div>
      <div class="stat-card"><div class="label">Due today</div><div class="value">${todayTasks.length}</div><div class="sub">${overdueTasks.length} overdue</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header">Next actions${viewingLabel()}</div>
        <div class="card-body">${sortedTasks.length === 0 ? '<div class="empty-state"><p>Nothing due — all caught up</p></div>' : `<ul class="task-list">${sortedTasks.slice(0, 8).map((t) => taskRowHTML(t, contactMap, false)).join("")}</ul>`}</div>
      </div>
      <div class="card">
        <div class="card-header">Pipeline snapshot</div>
        <div class="card-body pipeline-summary">
          ${getOpenStages().map((stage) => {
            const stageDeals = deals.filter((d) => d.stage === stage.name);
            const val = stageDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
            return `<div class="pipeline-row"><span><span class="badge badge-lead">${escapeHtml(stage.name)}</span> (${stageDeals.length})</span><strong>${formatCurrency(val)}</strong></div>`;
          }).join("")}
        </div>
      </div>
    </div>`;
  content.querySelector("#dash-search")?.addEventListener("click", () => navigate("search"));
  bindTaskCheckboxes();
  topbarActions.innerHTML = "";
}

function taskRowHTML(task, contactMap, showActions = true) {
  const contact = task.contactId ? contactMap[task.contactId] : null;
  let dueClass = "";
  if (!task.done && isOverdue(task.dueDate)) dueClass = "overdue";
  else if (!task.done && isToday(task.dueDate)) dueClass = "today";
  return `<li class="task-item ${task.done ? "done" : ""}" data-id="${task.id}">
    <input type="checkbox" class="task-checkbox" ${task.done ? "checked" : ""} ${canEdit() ? "" : "disabled"} />
    <div class="task-info">
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${contact ? `<div class="task-meta">${escapeHtml(contact.name)}</div>` : ""}
    </div>
    <span class="task-due ${dueClass}">${formatDate(task.dueDate)}</span>
    ${showActions && canEdit() ? `<div class="row-actions" style="opacity:1">
      <button class="btn btn-sm btn-secondary" data-edit-task="${task.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-delete-task="${task.id}">Delete</button>
    </div>` : ""}
  </li>`;
}

function bindTaskCheckboxes() {
  content.querySelectorAll(".task-checkbox:not([disabled])").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      const id = e.target.closest(".task-item").dataset.id;
      const task = await tasksDB.get(id);
      task.done = e.target.checked;
      await tasksDB.save(task);
      render();
    });
  });
}

// ── Search (company-wide directory) ──

const SEARCH_PAGE_SIZE = 50;

async function renderSearch() {
  if (typeof hasTeam === "function" && !hasTeam()) {
    content.innerHTML = `<div class="empty-state"><p>Join a team workspace to search the company directory.</p></div>`;
    topbarActions.innerHTML = "";
    return;
  }

  const [people, myDirectoryIds] = await Promise.all([
    directoryDB.all(),
    contactsDB.myDirectoryIds(),
  ]);
  const query = (content.dataset.search || "").trim().toLowerCase();
  const companyFilter = content.dataset.companyFilter || "";
  const ownerFilter = content.dataset.ownerFilter || "";
  const page = Math.max(1, Number(content.dataset.page) || 1);

  const companies = [...new Set(people.map((c) => c.company).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const owners = [...new Set(people.map((c) => parseContactMeta(c.notes).owner).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const filtered = people.filter((c) => {
    const meta = parseContactMeta(c.notes);
    const haystack = [c.name, c.email, c.company, c.phone, c.notes, meta.title, meta.owner]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (companyFilter && !(c.company || "").toLowerCase().includes(companyFilter.toLowerCase())) return false;
    if (ownerFilter && meta.owner !== ownerFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / SEARCH_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = filtered.slice((safePage - 1) * SEARCH_PAGE_SIZE, safePage * SEARCH_PAGE_SIZE);

  content.innerHTML = `
    <div class="page-banner search-banner">
      <strong>Company directory</strong>
      <span>${people.length.toLocaleString()} shared company contacts — add people to <em>My contacts</em> for your personal CRM</span>
    </div>
    <div class="search-toolbar">
      <input class="search-input search-input-wide" type="search" placeholder="Search name, company, title, owner, email…" value="${escapeHtml(content.dataset.search || "")}" id="directory-search" autofocus />
      <input class="search-filter" type="search" placeholder="Filter company…" value="${escapeHtml(companyFilter)}" id="directory-company" list="company-suggestions" />
      <datalist id="company-suggestions">${companies.slice(0, 200).map((co) => `<option value="${escapeHtml(co)}">`).join("")}</datalist>
      <select class="search-filter" id="directory-owner">
        <option value="">All owners</option>
        ${owners.map((o) => `<option value="${escapeHtml(o)}" ${ownerFilter === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
      </select>
    </div>
    <div class="search-meta">${filtered.length.toLocaleString()} match${filtered.length === 1 ? "" : "es"} · page ${safePage} of ${totalPages}</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Owner</th><th>Email</th><th></th></tr></thead>
          <tbody>${pageSlice.length === 0
            ? `<tr><td colspan="6"><div class="empty-state"><p>${query || companyFilter || ownerFilter ? "No matches — try different filters" : "No people in directory yet"}</p></div></td></tr>`
            : pageSlice.map((c) => {
              const meta = parseContactMeta(c.notes);
              const inMyCrm = myDirectoryIds.has(c.id);
              return `<tr>
                <td><div class="contact-cell"><span class="avatar">${initials(c.name)}</span>${escapeHtml(c.name)}</div></td>
                <td>${escapeHtml(meta.title || "—")}</td>
                <td>${escapeHtml(c.company || "—")}</td>
                <td>${escapeHtml(meta.owner || "—")}</td>
                <td>${escapeHtml(c.email || "—")}</td>
                <td><div class="row-actions" style="opacity:1">
                  <button class="btn btn-sm ${inMyCrm ? "btn-secondary" : "btn-primary"}" data-add-directory="${c.id}" ${inMyCrm ? "disabled" : ""}>${inMyCrm ? "In my CRM" : "Add to my CRM"}</button>
                  <button class="btn btn-sm btn-secondary" data-view-directory="${c.id}">View</button>
                </div></td>
              </tr>`;
            }).join("")}</tbody>
        </table>
      </div>
    </div>
    ${totalPages > 1 ? `<div class="search-pagination">
      <button class="btn btn-sm btn-secondary" id="search-prev" ${safePage <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${safePage} of ${totalPages}</span>
      <button class="btn btn-sm btn-secondary" id="search-next" ${safePage >= totalPages ? "disabled" : ""}>Next</button>
    </div>` : ""}`;

  const rerender = (patch = {}) => {
    Object.assign(content.dataset, patch);
    renderSearch();
  };

  content.querySelector("#directory-search")?.addEventListener("input", (e) => {
    clearTimeout(content._searchDebounce);
    content._searchDebounce = setTimeout(() => rerender({ search: e.target.value, page: "1" }), 250);
  });
  content.querySelector("#directory-company")?.addEventListener("input", (e) => {
    clearTimeout(content._companyDebounce);
    content._companyDebounce = setTimeout(() => rerender({ companyFilter: e.target.value, page: "1" }), 250);
  });
  content.querySelector("#directory-owner")?.addEventListener("change", (e) => {
    rerender({ ownerFilter: e.target.value, page: "1" });
  });
  content.querySelector("#search-prev")?.addEventListener("click", () => rerender({ page: String(safePage - 1) }));
  content.querySelector("#search-next")?.addEventListener("click", () => rerender({ page: String(safePage + 1) }));
  content.querySelectorAll("[data-add-directory]").forEach((b) => b.addEventListener("click", async () => {
    if (b.disabled) return;
    b.disabled = true;
    b.textContent = "Adding…";
    try {
      await contactsDB.addFromDirectory(b.dataset.addDirectory);
      renderSearch();
    } catch (err) {
      alert(err.message || "Could not add contact");
      b.disabled = false;
      b.textContent = "Add to my CRM";
    }
  }));
  content.querySelectorAll("[data-view-directory]").forEach((b) => b.addEventListener("click", () => openDirectoryPerson(b.dataset.viewDirectory)));
  topbarActions.innerHTML = "";
}

async function openDirectoryPerson(directoryPersonId) {
  const [person, myContact] = await Promise.all([
    directoryDB.get(directoryPersonId),
    contactsDB.findByDirectoryId(directoryPersonId),
  ]);
  const meta = parseContactMeta(person.notes);
  openModal(`${person.name} — Company directory`, `
    <div class="contact-detail-header">
      <span class="avatar avatar-lg">${initials(person.name)}</span>
      <div>
        <strong>${escapeHtml(person.name)}</strong>
        <div class="task-meta">${escapeHtml(meta.title || "")}${meta.title && person.company ? " · " : ""}${escapeHtml(person.company || "")}</div>
      </div>
    </div>
    ${person.email ? `<p><strong>Email</strong> ${escapeHtml(person.email)}</p>` : ""}
    ${meta.owner ? `<p><strong>Ploid owner</strong> ${escapeHtml(meta.owner)}</p>` : ""}
    ${person.notes ? `<div class="contact-static-notes"><strong>Details</strong><p>${escapeHtml(person.notes.replace(/\|/g, " · "))}</p></div>` : ""}
    <div style="margin-top:1rem;display:flex;gap:0.5rem">
      ${myContact
        ? `<button type="button" class="btn btn-primary btn-sm" id="open-my-contact">Open in my CRM</button>`
        : `<button type="button" class="btn btn-primary btn-sm" id="add-from-modal">Add to my CRM</button>`}
    </div>
    <input type="hidden" name="noop" value="1" />
  `, () => closeModal());

  modalBody.querySelector("#add-from-modal")?.addEventListener("click", async () => {
    await contactsDB.addFromDirectory(directoryPersonId);
    closeModal();
    navigate("contacts");
  });
  modalBody.querySelector("#open-my-contact")?.addEventListener("click", () => {
    closeModal();
    openContactDetail(myContact.id);
  });
}

// ── Contacts (personal) ──

async function renderContacts() {
  const [contacts, directorySize] = await Promise.all([
    contactsDB.all(),
    directoryDB.all().then((rows) => rows.length),
  ]);
  const sorted = contacts.sort((a, b) => a.name.localeCompare(b.name));

  content.innerHTML = `
    ${readOnlyBanner()}
    <div class="page-banner" style="background:var(--primary-light);color:var(--text)">
      <strong>My contacts</strong>
      <span>Your personal CRM (${sorted.length}) — browse ${directorySize.toLocaleString()} shared people in <button type="button" class="link-btn" id="goto-search">Search</button> and click <em>Add to my CRM</em></span>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th></th></tr></thead>
          <tbody>${sorted.length === 0
            ? `<tr><td colspan="5"><div class="empty-state"><p>Your CRM is empty. Open <button type="button" class="link-btn" id="goto-search">Search</button>, find someone, and click <strong>Add to my CRM</strong>.</p></div></td></tr>`
            : sorted.map(contactRowHTML).join("")}</tbody>
        </table>
      </div>
    </div>`;

  content.querySelector("#goto-search")?.addEventListener("click", () => navigate("search"));
  content.querySelectorAll("[data-view-contact]").forEach((b) => b.addEventListener("click", () => openContactDetail(b.dataset.viewContact)));
  content.querySelectorAll("[data-edit-contact]").forEach((b) => b.addEventListener("click", () => openContactForm(b.dataset.editContact)));
  content.querySelectorAll("[data-delete-contact]").forEach((b) => b.addEventListener("click", async () => {
    if (confirm("Delete this contact?")) { await contactsDB.delete(b.dataset.deleteContact); render(); }
  }));

  topbarActions.innerHTML = "";
  if (canEdit()) topbarActions.appendChild(btn("+ Add contact", "btn btn-primary", () => openContactForm()));
}

function contactRowHTML(c) {
  return `<tr>
    <td><div class="contact-cell"><span class="avatar">${initials(c.name)}</span>${escapeHtml(c.name)}</div></td>
    <td>${escapeHtml(c.company || "—")}</td>
    <td>${escapeHtml(c.email || "—")}</td>
    <td>${escapeHtml(c.phone || "—")}</td>
    <td><div class="row-actions" style="opacity:1">
      <button class="btn btn-sm btn-secondary" data-view-contact="${c.id}">360 view</button>
      ${canEdit() ? `<button class="btn btn-sm btn-secondary" data-edit-contact="${c.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-delete-contact="${c.id}">Delete</button>` : ""}
    </div></td>
  </tr>`;
}

function openContactForm(id) {
  Promise.all([id ? contactsDB.get(id) : Promise.resolve({}), companiesDB.all()]).then(([contact, companies]) => {
    const c = contact || {};
    const companyOptions = companies.map((co) =>
      `<option value="${co.id}" ${c.companyId === co.id ? "selected" : ""}>${escapeHtml(co.name)}</option>`
    ).join("");
    openModal(id ? "Edit contact" : "New contact", `
      <div class="form-group"><label>Name *</label><input name="name" required value="${escapeHtml(c.name || "")}" /></div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${escapeHtml(c.email || "")}" /></div>
        <div class="form-group"><label>Phone</label><input name="phone" type="tel" value="${escapeHtml(c.phone || "")}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Company</label><select name="companyId"><option value="">— None —</option>${companyOptions}</select></div>
        <div class="form-group"><label>Legacy company text</label><input name="company" value="${escapeHtml(c.company || "")}" /></div>
      </div>
      <div class="form-group"><label>Next action</label><input name="nextAction" value="${escapeHtml(c.nextAction || "")}" placeholder="What to do next" /></div>
      <div class="form-group"><label>Notes</label><textarea name="notes">${escapeHtml(c.notes || "")}</textarea></div>
      <input type="hidden" name="id" value="${c.id || ""}" />
    `, async (fd) => {
      await contactsDB.save({
        id: fd.get("id") || undefined,
        name: fd.get("name").trim(),
        email: fd.get("email").trim(),
        phone: fd.get("phone").trim(),
        company: fd.get("company").trim(),
        companyId: fd.get("companyId") || null,
        nextAction: fd.get("nextAction").trim(),
        notes: fd.get("notes").trim(),
      });
      closeModal();
      render();
    });
  });
}

async function openContactDetail(contactId) {
  const [contact, notes, events] = await Promise.all([
    contactsDB.get(contactId),
    notesDB.forContact(contactId),
    timelineDB.forContact(contactId),
  ]);

  openModal(`${contact.name} — Customer 360`, `
    <div class="contact-detail-header">
      <span class="avatar avatar-lg">${initials(contact.name)}</span>
      <div>
        <strong>${escapeHtml(contact.name)}</strong>
        <div class="task-meta">${escapeHtml(contact.company || "")} · ${escapeHtml(contact.email || "")}</div>
      </div>
    </div>
    ${contact.notes ? `<div class="contact-static-notes"><strong>Summary</strong><p>${escapeHtml(contact.notes)}</p></div>` : ""}
    ${contact.nextAction ? `<div class="contact-static-notes"><strong>Next action</strong><p>${escapeHtml(contact.nextAction)}</p></div>` : ""}
    ${canEdit() ? `<div class="quick-log-bar">
      <button type="button" class="btn btn-sm btn-secondary" data-log="call" data-cid="${contactId}">Log call</button>
      <button type="button" class="btn btn-sm btn-secondary" data-log="email" data-cid="${contactId}">Log email</button>
      <button type="button" class="btn btn-sm btn-secondary" data-log="meeting" data-cid="${contactId}">Log meeting</button>
    </div>
    <div class="form-group" style="margin-top:1rem"><label>Add note</label><textarea id="new-note" placeholder="Called, emailed, met…"></textarea>
      <button type="button" class="btn btn-primary btn-sm" id="add-note-btn" style="margin-top:0.5rem">Add note</button></div>` : ""}
    <div class="form-group"><label>Timeline</label>${renderTimelineHTML(events)}</div>
    <details style="margin-top:0.5rem"><summary style="cursor:pointer;font-weight:600">Notes (${notes.length})</summary>
    <div class="notes-timeline">${notes.length === 0 ? '<p class="empty-state" style="padding:1rem 0">No notes yet</p>' : notes.map((n) => `
      <div class="note-item">
        <div class="note-meta">${escapeHtml(n.profiles?.full_name || "Team member")} · ${formatDateTime(n.created_at)}</div>
        <div class="note-content">${escapeHtml(n.content)}</div>
      </div>`).join("")}</div></details>
    <input type="hidden" name="noop" value="1" />
  `, () => closeModal());

  document.getElementById("add-note-btn")?.addEventListener("click", async () => {
    const text = document.getElementById("new-note").value.trim();
    if (!text) return;
    await notesDB.add(contactId, text);
    await timelineDB.logActivity("note", "Note added", text, { contactId });
    closeModal();
    openContactDetail(contactId);
  });
  modalBody.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => openQuickLog(b.dataset.log, { contactId: b.dataset.cid })));
}

// Deals pipeline is in views.js (renderDealsPipeline)

async function openDealForm(id) {
  const [deal, contacts] = await Promise.all([id ? dealsDB.get(id) : null, contactsDB.all()]);
  const d = deal || {};
  const contactOptions = contacts.map((c) =>
    `<option value="${c.id}" ${d.contactId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");

  openModal(id ? "Edit deal" : "New deal", `
    <div class="form-group"><label>Title *</label><input name="title" required value="${escapeHtml(d.title || "")}" /></div>
    <div class="form-row">
      <div class="form-group"><label>Amount ($)</label><input name="amount" type="number" min="0" step="1" value="${d.amount ?? ""}" /></div>
      <div class="form-group"><label>Stage</label>
        <select name="stage">${getPipelineStages().map((s) => `<option ${d.stage === s.name ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="form-group"><label>Contact</label><select name="contactId"><option value="">— None —</option>${contactOptions}</select></div>
    <div class="form-group"><label>Next action</label><input name="nextAction" value="${escapeHtml(d.nextAction || "")}" placeholder="What to do next on this deal" /></div>
    <div class="form-group"><label>Notes</label><textarea name="notes">${escapeHtml(d.notes || "")}</textarea></div>
    <input type="hidden" name="id" value="${d.id || ""}" />
    ${id ? `<div style="margin-top:1rem"><button type="button" class="btn btn-danger btn-sm" id="delete-deal">Delete deal</button></div>` : ""}
  `, async (fd) => {
    await dealsDB.save({
      id: fd.get("id") || undefined,
      title: fd.get("title").trim(),
      amount: fd.get("amount") ? Number(fd.get("amount")) : null,
      stage: fd.get("stage"),
      contactId: fd.get("contactId") || null,
      nextAction: fd.get("nextAction").trim(),
      notes: fd.get("notes").trim(),
    });
    closeModal();
    render();
  });

  document.getElementById("delete-deal")?.addEventListener("click", async () => {
    if (confirm("Delete this deal?")) { await dealsDB.delete(id); closeModal(); render(); }
  });
}

// ── Tasks ──

function memberSelectOptions(selectedId, { includeEmpty = false, emptyLabel = "— Select person —" } = {}) {
  const list = getMembers();
  let html = includeEmpty ? `<option value="">${escapeHtml(emptyLabel)}</option>` : "";
  html += list.map((m) =>
    `<option value="${m.id}" ${selectedId === m.id ? "selected" : ""}>${escapeHtml(m.full_name || m.email || "Member")}</option>`
  ).join("");
  return html;
}

function getSelectedTranscriptAssignee() {
  return document.getElementById("transcript-assignee")?.value || session?.user?.id || getViewingUserId();
}

function openTaskDetailModal(task) {
  const dueLabel = task.dueDate ? formatDate(task.dueDate) : "No due date";
  openModal(task.title, `
    <div class="task-detail">
      <p class="task-meta">Due ${escapeHtml(dueLabel)}${task.transcriptId ? " · From call transcript" : ""}</p>
      ${task.description
        ? `<div class="task-detail-body">${escapeHtml(task.description).replace(/\n/g, "<br>")}</div>`
        : "<p class=\"task-meta\">No extra details for this task.</p>"}
    </div>
    <input type="hidden" name="noop" value="1" />
  `, () => closeModal());
}

function renderTaskCalendar(tasks, year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const byDate = {};
  tasks.filter((t) => !t.done && t.dueDate).forEach((t) => {
    if (!byDate[t.dueDate]) byDate[t.dueDate] = [];
    byDate[t.dueDate].push(t);
  });

  let cells = "";
  for (let i = 0; i < startPad; i++) cells += `<div class="calendar-day is-empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = toDateInputValue(new Date(year, month, day));
    const dayTasks = byDate[dateKey] || [];
    const isTodayCell = isToday(dateKey);
    cells += `<div class="calendar-day ${isTodayCell ? "is-today" : ""}">
      <div class="calendar-day-num">${day}</div>
      <div class="calendar-day-tasks">${dayTasks.map((t) =>
        `<button type="button" class="calendar-task-chip ${isOverdue(t.dueDate) ? "overdue" : ""}" data-task-detail="${t.id}">${escapeHtml(t.title)}</button>`
      ).join("")}</div>
    </div>`;
  }

  return `
    <div class="calendar-toolbar">
      <button type="button" class="btn btn-sm btn-secondary" id="calendar-prev">←</button>
      <strong>${monthLabel}</strong>
      <button type="button" class="btn btn-sm btn-secondary" id="calendar-next">→</button>
    </div>
    <div class="calendar-grid">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="calendar-dow">${d}</div>`).join("")}
      ${cells}
    </div>`;
}

async function renderTasks() {
  const [tasks, contacts, deals] = await Promise.all([tasksDB.all(), contactsDB.all(), dealsDB.all()]);
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const dealMap = Object.fromEntries(deals.map((d) => [d.id, d]));
  const view = content.dataset.tasksView || "calendar";
  const filter = content.dataset.filter || "pending";
  const calYear = Number(content.dataset.calYear) || new Date().getFullYear();
  const calMonth = Number(content.dataset.calMonth) ?? new Date().getMonth();

  let filtered = [...tasks];
  if (filter === "pending") filtered = filtered.filter((t) => !t.done);
  else if (filter === "done") filtered = filtered.filter((t) => t.done);
  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const viewingName = getMemberName(getViewingUserId());

  content.innerHTML = `
    ${readOnlyBanner()}
    <div class="page-banner">
      <strong>Tasks for ${escapeHtml(viewingName)}</strong>
      <span>Transcript follow-ups appear on the calendar on their due date — click a title for details</span>
    </div>
    <div class="search-bar">
      <button class="btn btn-sm ${view === "calendar" ? "btn-primary" : "btn-secondary"}" data-tasks-view="calendar">Calendar</button>
      <button class="btn btn-sm ${view === "list" ? "btn-primary" : "btn-secondary"}" data-tasks-view="list">List</button>
      <span style="flex:1"></span>
      <button class="btn btn-sm ${filter === "pending" ? "btn-primary" : "btn-secondary"}" data-filter="pending">Pending</button>
      <button class="btn btn-sm ${filter === "done" ? "btn-primary" : "btn-secondary"}" data-filter="done">Completed</button>
      <button class="btn btn-sm ${filter === "all" ? "btn-primary" : "btn-secondary"}" data-filter="all">All</button>
    </div>
    <div class="card"><div class="card-body">${view === "calendar"
      ? (filtered.length === 0
        ? '<div class="empty-state"><p>No tasks on your calendar yet — assign a call transcript to add follow-ups.</p></div>'
        : renderTaskCalendar(filtered, calYear, calMonth))
      : (filtered.length === 0
        ? '<div class="empty-state"><p>No tasks here</p></div>'
        : `<ul class="task-list">${filtered.map((t) => {
          const contact = t.contactId ? contactMap[t.contactId] : null;
          const deal = t.dealId ? dealMap[t.dealId] : null;
          const meta = [contact?.name, deal?.title, t.transcriptId ? "Call follow-up" : ""].filter(Boolean).join(" · ");
          let dueClass = "";
          if (!t.done && isOverdue(t.dueDate)) dueClass = "overdue";
          else if (!t.done && isToday(t.dueDate)) dueClass = "today";
          return `<li class="task-item ${t.done ? "done" : ""}" data-id="${t.id}">
            <input type="checkbox" class="task-checkbox" ${t.done ? "checked" : ""} ${canEdit() ? "" : "disabled"} />
            <button type="button" class="task-info task-info-btn" data-task-detail="${t.id}">
              <div class="task-title">${escapeHtml(t.title)}</div>
              ${meta ? `<div class="task-meta">${escapeHtml(meta)}</div>` : ""}
            </button>
            <span class="task-due ${dueClass}">${formatDate(t.dueDate)}</span>
            ${canEdit() ? `<div class="row-actions" style="opacity:1">
              <button class="btn btn-sm btn-secondary" data-edit-task="${t.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-delete-task="${t.id}">Delete</button>
            </div>` : ""}
          </li>`;
        }).join("")}</ul>`)}
    </div></div>`;

  content.querySelectorAll("[data-tasks-view]").forEach((b) => b.addEventListener("click", () => {
    content.dataset.tasksView = b.dataset.tasksView;
    renderTasks();
  }));
  content.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    content.dataset.filter = b.dataset.filter;
    renderTasks();
  }));

  document.getElementById("calendar-prev")?.addEventListener("click", () => {
    const m = calMonth - 1;
    content.dataset.calMonth = m < 0 ? 11 : m;
    content.dataset.calYear = m < 0 ? calYear - 1 : calYear;
    renderTasks();
  });
  document.getElementById("calendar-next")?.addEventListener("click", () => {
    const m = calMonth + 1;
    content.dataset.calMonth = m > 11 ? 0 : m;
    content.dataset.calYear = m > 11 ? calYear + 1 : calYear;
    renderTasks();
  });

  bindTaskCheckboxes();
  bindTaskDetailButtons();
  content.querySelectorAll("[data-edit-task]").forEach((b) => b.addEventListener("click", () => openTaskForm(b.dataset.editTask)));
  content.querySelectorAll("[data-delete-task]").forEach((b) => b.addEventListener("click", async () => {
    if (confirm("Delete this task?")) { await tasksDB.delete(b.dataset.deleteTask); render(); }
  }));
  topbarActions.innerHTML = "";
  if (canEdit()) topbarActions.appendChild(btn("+ Add task", "btn btn-primary", () => openTaskForm()));
}

function bindTaskDetailButtons() {
  content.querySelectorAll("[data-task-detail]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const task = await tasksDB.get(btn.dataset.taskDetail);
      openTaskDetailModal(task);
    });
  });
}

async function openTaskForm(id) {
  const [task, contacts, deals] = await Promise.all([
    id ? tasksDB.get(id) : null,
    contactsDB.all(),
    dealsDB.all(),
  ]);
  const t = task || {};
  const contactOptions = contacts.map((c) => `<option value="${c.id}" ${t.contactId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  const dealOptions = deals.map((d) => `<option value="${d.id}" ${t.dealId === d.id ? "selected" : ""}>${escapeHtml(d.title)}</option>`).join("");

  openModal(id ? "Edit task" : "New task", `
    <div class="form-group"><label>Title *</label><input name="title" required value="${escapeHtml(t.title || "")}" /></div>
    <div class="form-group"><label>Due date</label><input name="dueDate" type="date" value="${t.dueDate || ""}" /></div>
    <div class="form-group"><label>Assign to</label><select name="assignedTo">${memberSelectOptions(t.assignedTo || getViewingUserId())}</select></div>
    <div class="form-group"><label>Contact</label><select name="contactId"><option value="">— None —</option>${contactOptions}</select></div>
    <div class="form-group"><label>Deal</label><select name="dealId"><option value="">— None —</option>${dealOptions}</select></div>
    <input type="hidden" name="id" value="${t.id || ""}" />
  `, async (fd) => {
    await tasksDB.save({
      id: fd.get("id") || undefined,
      title: fd.get("title").trim(),
      dueDate: fd.get("dueDate") || null,
      assignedTo: fd.get("assignedTo") || getViewingUserId(),
      contactId: fd.get("contactId") || null,
      dealId: fd.get("dealId") || null,
      description: t.description || "",
      done: t.done || false,
    });
    closeModal();
    render();
  });
}

// ── Call transcripts, LinkedIn & priorities ──

function importanceBadge(level) {
  const cls = { high: "badge-lost", medium: "badge-proposal", low: "badge-lead" }[level] || "badge-lead";
  return `<span class="badge ${cls}">${escapeHtml(level || "medium")}</span>`;
}

const CONVERSATION_CONFIG = {
  call: {
    bannerClass: "transcripts-banner",
    icon: "☎",
    pageTitle: "Call Priorities",
    subtitle: "One card per call — ranked by importance. Tasks sync to the assignee's calendar.",
    listHeader: "Your call transcripts",
    emptyText: "Upload a call transcript to get a summary and next steps.",
    searchPlaceholder: "Search by title, filename, summary, or transcript text…",
    searchMeta: (n) => `${n} transcript${n === 1 ? "" : "s"}`,
    uploadLabel: "Upload call transcript",
    uploadHint: "Works: .txt · .pdf · .vtt · .srt · .md · .csv · Word/audio: use Paste text",
    pasteTitle: "Paste call transcript",
    summaryLabel: "Call summary",
    stepsLabel: "Next steps",
    fullLabel: "Full transcript",
    deleteConfirm: "Delete this transcript?",
    sourceType: "call",
    acceptFile: ".txt,.md,.csv,.vtt,.srt,.log,.pdf,text/plain,application/pdf",
  },
  linkedin: {
    bannerClass: "linkedin-banner",
    icon: "in",
    pageTitle: "LinkedIn Conversations",
    subtitle: "Paste LinkedIn chats — ranked by importance. Meetings and follow-ups go to the assignee's calendar.",
    listHeader: "Your LinkedIn conversations",
    emptyText: "Paste a LinkedIn conversation export or copy the chat text from LinkedIn.",
    searchPlaceholder: "Search conversations by name, summary, or chat text…",
    searchMeta: (n) => `${n} conversation${n === 1 ? "" : "s"}`,
    uploadLabel: "Upload LinkedIn chat (.txt)",
    uploadHint: "Copy the conversation from LinkedIn and paste it, or upload a .txt file",
    pasteTitle: "Paste LinkedIn conversation",
    summaryLabel: "Conversation summary",
    stepsLabel: "Follow-ups & meetings",
    fullLabel: "Full chat",
    deleteConfirm: "Delete this conversation?",
    sourceType: "linkedin",
    acceptFile: ".txt,.md,.csv,text/plain",
  },
};

function transcriptPriorityCardHTML(t, index, cfg) {
  const card = buildTranscriptCardData(t);
  const searchBlob = escapeHtml(transcriptSearchBlob(t));
  const topImportance = conversationTopImportance(t);
  const statusBadge = t.status !== "done"
    ? `<span class="badge ${t.status === "error" ? "badge-lost" : "badge-lead"}">${escapeHtml(t.status)}</span>`
    : importanceBadge(topImportance);

  if (t.status === "analyzing") {
    return `<div class="transcript-priority-card is-pending" data-search="${searchBlob}">
      <div class="transcript-priority-toggle is-static">
        <div class="transcript-priority-main">
          <span class="transcript-priority-num">#${index + 1}</span>
          <div>
            <div class="transcript-priority-title">${escapeHtml(t.title)} ${statusBadge}</div>
            <div class="transcript-priority-meta">${formatDateTime(t.createdAt)}${t.filename ? ` · ${escapeHtml(t.filename)}` : ""}${t.assignedTo ? ` · Assigned to ${escapeHtml(getMemberName(t.assignedTo))}` : ""}</div>
            <div class="transcript-priority-preview">Analyzing…</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  return `<details class="transcript-priority-card" data-search="${searchBlob}">
    <summary class="transcript-priority-toggle">
      <div class="transcript-priority-main">
        <span class="transcript-priority-num">#${index + 1}</span>
        <div>
          <div class="transcript-priority-title">${escapeHtml(t.title)} ${statusBadge}</div>
          <div class="transcript-priority-meta">${formatDateTime(t.createdAt)}${t.filename ? ` · ${escapeHtml(t.filename)}` : ""}${t.assignedTo ? ` · Assigned to ${escapeHtml(getMemberName(t.assignedTo))}` : ""}</div>
          <div class="transcript-priority-preview">${escapeHtml(card.preview)}</div>
        </div>
      </div>
      <span class="transcript-priority-chevron" aria-hidden="true"></span>
    </summary>
    <div class="transcript-priority-body">
      ${t.status === "error" ? `<p class="auth-error">${escapeHtml(t.errorMessage || "Analysis failed")}</p>` : ""}
      ${card.summaryLines.length ? `
        <div class="transcript-priority-section">
          <h4>${cfg.summaryLabel}</h4>
          <ul class="transcript-summary-list">${card.summaryLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        </div>` : ""}
      ${card.nextSteps.length ? `
        <div class="transcript-priority-section">
          <h4>${cfg.stepsLabel}</h4>
          <ol class="next-steps-list">${card.nextSteps.map((step, si) => `
            <li class="next-step-item">
              <div class="next-step-head">${importanceBadge(step.importance)} ${step.topic ? `<span class="next-step-topic">${escapeHtml(step.topic)}</span>` : ""}</div>
              <div class="next-step-text">
                ${step.person ? `<span class="next-step-person">${escapeHtml(step.person)}</span>` : ""}
                ${escapeHtml(step.text)}
              </div>
              ${step.outreach ? `
                <details class="outreach-inline">
                  <summary>Draft outreach message</summary>
                  <div class="outreach-draft" id="draft-${index}-${si}">${escapeHtml(step.outreach)}</div>
                  <button type="button" class="btn btn-sm btn-secondary copy-draft-btn" data-draft-id="draft-${index}-${si}">Copy</button>
                </details>` : ""}
              ${step.contactId && canEdit() ? `<button type="button" class="btn btn-sm btn-secondary" data-goto-contact="${step.contactId}">Open contact</button>` : ""}
            </li>`).join("")}</ol>
        </div>` : `<p class="task-meta">No follow-ups found. Click Re-analyze or edit the text and try again.</p>`}
      <div class="transcript-priority-actions">
        ${canEdit() ? `
          <div class="transcript-assign-row">
            <label for="assign-${t.id}">Assign tasks to</label>
            <select id="assign-${t.id}" class="transcript-assign-select" data-transcript-assign="${t.id}">${memberSelectOptions(t.assignedTo || session?.user?.id)}</select>
          </div>
          ${t.status === "done" ? `<button type="button" class="btn btn-sm btn-primary" data-sync-transcript-tasks="${t.id}">Add to calendar</button>` : ""}
          <button type="button" class="btn btn-sm btn-secondary" data-reanalyze-transcript="${t.id}">Re-analyze</button>
          <button type="button" class="btn btn-sm btn-danger" data-delete-transcript="${t.id}">Delete</button>` : ""}
      </div>
      ${t.content ? `
        <details class="transcript-full-wrap">
          <summary>${cfg.fullLabel}</summary>
          <pre class="transcript-raw">${escapeHtml(t.content)}</pre>
        </details>` : ""}
    </div>
  </details>`;
}

function bindTranscriptCardActions(cfg) {
  content.querySelectorAll("[data-transcript-assign]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      e.stopPropagation();
      try {
        await transcriptsDB.setAssignee(select.dataset.transcriptAssign, select.value);
      } catch (err) {
        alert("Could not save assignee: " + (err.message || err));
        render();
      }
    });
  });
  content.querySelectorAll("[data-sync-transcript-tasks]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const transcriptId = btn.dataset.syncTranscriptTasks;
      const assigneeId = document.getElementById(`assign-${transcriptId}`)?.value;
      if (!assigneeId) {
        alert("Choose who to assign tasks to.");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Adding…";
      try {
        await transcriptsDB.setAssignee(transcriptId, assigneeId);
        const transcript = await transcriptsDB.get(transcriptId);
        const created = await tasksDB.syncFromTranscript(transcript, assigneeId);
        alert(created.length
          ? `Added ${created.length} task${created.length === 1 ? "" : "s"} to ${getMemberName(assigneeId)}'s calendar.`
          : "Tasks already on calendar — no new items added.");
        render();
      } catch (err) {
        alert("Could not add tasks: " + (err.message || err));
        render();
      }
    });
  });
  content.querySelectorAll("[data-reanalyze-transcript]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = "Analyzing…";
      try {
        await transcriptsDB.process(btn.dataset.reanalyzeTranscript);
        render();
      } catch (err) {
        alert("Re-analyze failed: " + (err.message || err));
        render();
      }
    });
  });
  content.querySelectorAll("[data-delete-transcript]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm(cfg.deleteConfirm)) {
        await transcriptsDB.delete(btn.dataset.deleteTranscript);
        render();
      }
    });
  });
  content.querySelectorAll("[data-goto-contact]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openContactDetail(btn.dataset.gotoContact);
    });
  });
}

function bindCopyDraftButtons() {
  content.querySelectorAll(".copy-draft-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const el = document.getElementById(btn.dataset.draftId);
      if (!el) return;
      navigator.clipboard.writeText(el.textContent).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 2000);
      });
    });
  });
}

function bindTranscriptSearch(total, metaFn) {
  const input = document.getElementById("transcript-search");
  const meta = document.getElementById("transcript-search-meta");
  const list = document.getElementById("transcript-list");
  const empty = document.getElementById("transcript-search-empty");
  if (!input || !list) return;

  function apply() {
    content.dataset.transcriptSearch = input.value;
    const q = input.value.trim().toLowerCase();
    const cards = list.querySelectorAll("[data-search]");
    let visible = 0;
    cards.forEach((card) => {
      const match = !q || card.dataset.search.includes(q);
      card.hidden = !match;
      if (match) visible += 1;
    });
    if (meta) {
      meta.textContent = q
        ? `${visible} of ${total} shown`
        : (metaFn ? metaFn(total) : `${total} items`);
    }
    if (empty) empty.hidden = visible > 0 || !q;
  }

  input.addEventListener("input", apply);
  apply();
}

async function renderConversationInbox(sourceType) {
  const cfg = CONVERSATION_CONFIG[sourceType];
  content.dataset.conversationSource = sourceType;
  const transcripts = sortConversationsByImportance(await transcriptsDB.all({ sourceType: cfg.sourceType }));
  const analyzing = transcripts.filter((t) => t.status === "analyzing");
  const savedSearch = content.dataset.transcriptSearch || "";

  content.innerHTML = `
    ${readOnlyBanner()}
    <div class="page-banner ${cfg.bannerClass}">
      <strong>${cfg.icon} ${cfg.pageTitle}</strong>
      <span>${cfg.subtitle}</span>
    </div>
    ${cfg.sourceType === "linkedin" && canEdit() ? `
    <div class="card extension-setup-card">
      <div class="card-header">LinkedIn Chrome extension</div>
      <div class="card-body">
        <p class="task-meta">Load the extension from the <code>extension/</code> folder (Chrome → Extensions → Load unpacked). It shows threads where someone replied, ranked by importance, and syncs meetings and follow-ups to your calendar.</p>
        <ol class="extension-steps">
          <li>Open <a href="https://www.linkedin.com/messaging/" target="_blank" rel="noopener">LinkedIn Messaging</a></li>
          <li>Extension popup → ⚙ → paste connection → Save</li>
          <li>Refresh inbox → select people → Add to CRM calendar</li>
        </ol>
        <button type="button" class="btn btn-sm btn-primary" id="copy-extension-connection">Copy connection for extension</button>
      </div>
    </div>` : ""}
    ${canEdit() ? `
    <div class="upload-zone" id="upload-zone" data-source-type="${cfg.sourceType}">
      <input type="file" id="transcript-file" accept="${cfg.acceptFile}" hidden />
      <div class="upload-icon">${cfg.icon}</div>
      <p><strong>${cfg.uploadLabel}</strong></p>
      <p class="task-meta">${cfg.sourceType === "linkedin" ? "Paste from LinkedIn messaging or upload a text file" : "Drop a file here, or choose one below"}</p>
      <p class="task-meta upload-formats">${cfg.uploadHint}</p>
      <div class="upload-actions">
        <label for="transcript-file" class="btn btn-primary btn-sm">Choose file</label>
        <button type="button" class="btn btn-secondary btn-sm" id="paste-transcript-btn">Or paste text</button>
      </div>
      <div class="transcript-upload-assign">
        <label for="transcript-assignee">Assign follow-up tasks to</label>
        <select id="transcript-assignee" class="search-filter">${memberSelectOptions(session?.user?.id)}</select>
      </div>
    </div>` : `<div class="readonly-banner">Upload is disabled while viewing another team member's workspace. Switch back to yourself to upload.</div>`}

    ${analyzing.length ? `<div class="analyzing-banner">Analyzing ${analyzing.length} item(s)…</div>` : ""}

    <div class="card">
      <div class="card-header">${cfg.listHeader} <span class="task-meta">— sorted by importance</span></div>
      ${transcripts.length ? `
      <div class="transcript-search-bar">
        <input type="search" id="transcript-search" class="search-input search-input-wide" placeholder="${cfg.searchPlaceholder}" value="${escapeHtml(savedSearch)}" />
        <span class="search-meta" id="transcript-search-meta"></span>
      </div>` : ""}
      <div class="card-body transcript-priority-list" id="transcript-list">
        ${transcripts.length === 0
          ? `<div class="empty-state"><p>${cfg.emptyText}</p></div>`
          : `${transcripts.map((t, i) => transcriptPriorityCardHTML(t, i, cfg)).join("")}
             <div class="empty-state" id="transcript-search-empty" hidden><p>No matches for your search.</p></div>`}
      </div>
    </div>`;

  if (canEdit()) bindConversationUpload(cfg);
  if (cfg.sourceType === "linkedin") bindExtensionSetup();
  bindCopyDraftButtons();
  bindTranscriptCardActions(cfg);
  if (transcripts.length) bindTranscriptSearch(transcripts.length, cfg.searchMeta);

  topbarActions.innerHTML = "";
}

async function renderTranscripts() {
  return renderConversationInbox("call");
}

async function renderLinkedIn() {
  return renderConversationInbox("linkedin");
}

async function processLinkedInFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const ids = params.getAll("process_linkedin");
  if (!ids.length || !getSession()?.access_token) return;
  content.innerHTML = '<div class="empty-state"><p>Processing LinkedIn conversations from extension…</p></div>';
  for (const id of ids) {
    try {
      await transcriptsDB.process(id);
    } catch (e) {
      console.error("LinkedIn process failed:", e);
    }
  }
  window.history.replaceState({}, "", `${window.location.pathname}?v=21`);
  navigate("linkedin");
}

function bindExtensionSetup() {
  document.getElementById("copy-extension-connection")?.addEventListener("click", async () => {
    const info = getExtensionConnectInfo();
    if (!info.accessToken) {
      alert("Sign in to Team CRM first.");
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
    alert("Connection copied. Open the extension popup → ⚙ → paste → Save connection.");
  });
}

function bindConversationUpload(cfg) {
  const zone = document.getElementById("upload-zone");
  const fileInput = document.getElementById("transcript-file");
  if (!zone || !fileInput) return;

  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleTranscriptFile(e.dataTransfer.files[0], fileInput, cfg.sourceType);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleTranscriptFile(fileInput.files[0], fileInput, cfg.sourceType);
  });
  document.getElementById("paste-transcript-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    openPasteTranscriptForm(cfg);
  });
}

const UNSUPPORTED_TRANSCRIPT_EXT = /\.(docx?|pptx?|xlsx?|html?|htm|zip|mp3|mp4|wav|m4a|webm|png|jpe?g)$/i;

async function extractPdfText(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("PDF reader did not load — hard refresh the page (Cmd+Shift+R) or paste the text instead.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const parts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const rows = groupPdfTextRows(content.items);
    parts.push(rows.join("\n"));
  }
  return normalizeTranscriptText(parts.join("\n\n"));
}

function groupPdfTextRows(items) {
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 4) return yDiff;
    return a.transform[4] - b.transform[4];
  });
  const rows = [];
  let row = [];
  let lastY = null;
  for (const item of sorted) {
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 4) {
      if (row.length) rows.push(joinPdfRow(row));
      row = [];
    }
    row.push(item);
    lastY = y;
  }
  if (row.length) rows.push(joinPdfRow(row));
  return rows.filter(Boolean);
}

function joinPdfRow(items) {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  let text = "";
  let lastEnd = null;
  for (const item of sorted) {
    const x = item.transform[4];
    const gap = lastEnd === null ? 0 : x - lastEnd;
    if (gap > 3) text += gap > 8 ? " " : "";
    text += item.str;
    lastEnd = x + (item.width || item.str.length * 4);
  }
  return text.trim();
}

async function readTranscriptFile(file) {
  if (/\.pdf$/i.test(file.name)) return extractPdfText(file);
  return normalizeTranscriptText(await file.text());
}

async function handleTranscriptFile(file, fileInput, sourceType = "call") {
  if (!file) return;

  if (sourceType === "linkedin" && /\.pdf$/i.test(file.name)) {
    alert("For LinkedIn, paste the chat text or upload a .txt file — PDF is not supported here.");
    if (fileInput) fileInput.value = "";
    return;
  }

  if (UNSUPPORTED_TRANSCRIPT_EXT.test(file.name)) {
    alert(
      `"${file.name}" can't be read as text.\n\n` +
      "Try one of these:\n" +
      "• Save/export as .txt or .pdf\n" +
      "• Click \"Or paste text\" and paste the transcript\n\n" +
      "Word and audio files are not supported for direct upload."
    );
    if (fileInput) fileInput.value = "";
    return;
  }

  const maxSize = /\.pdf$/i.test(file.name) ? 10000000 : 2000000;
  if (file.size > maxSize) {
    alert(`File too large — max ${/\.pdf$/i.test(file.name) ? "10MB" : "2MB"}. Paste a shorter excerpt if needed.`);
    if (fileInput) fileInput.value = "";
    return;
  }

  let text;
  try {
    if (/\.pdf$/i.test(file.name)) {
      content.innerHTML = '<div class="empty-state"><p>Reading PDF…</p></div>';
    }
    text = await readTranscriptFile(file);
  } catch (err) {
    alert(`Could not read "${file.name}": ${err.message || err}\n\nTry pasting the transcript text instead.`);
    if (fileInput) fileInput.value = "";
    render();
    return;
  }

  if (!text.trim() || text.trim().length < 20) {
    alert(
      "Could not find enough text in that file.\n\n" +
      "If it's a scanned PDF (image only), copy/paste the text manually or use \"Or paste text\"."
    );
    if (fileInput) fileInput.value = "";
    render();
    return;
  }

  await uploadAndAnalyze(
    text.trim(),
    file.name.replace(/\.[^.]+$/, ""),
    file.name,
    getSelectedTranscriptAssignee(),
    sourceType
  );
  if (fileInput) fileInput.value = "";
}

function openPasteTranscriptForm(cfg) {
  openModal(cfg.pasteTitle, `
    <div class="form-group"><label>Title</label><input name="title" required placeholder="${cfg.sourceType === "linkedin" ? "Jane Smith — LinkedIn" : "Acme call — June 16"}" /></div>
    <div class="form-group"><label>Assign follow-up tasks to</label><select name="assignedTo">${memberSelectOptions(session?.user?.id)}</select></div>
    <div class="form-group"><label>${cfg.sourceType === "linkedin" ? "Conversation text" : "Transcript"}</label><textarea name="content" required placeholder="${cfg.sourceType === "linkedin" ? "Paste the LinkedIn message thread here…" : "Paste the full call transcript here…"}" style="min-height:200px"></textarea></div>
    <input type="hidden" name="noop" value="1" />
  `, async (fd) => {
    closeModal();
    await uploadAndAnalyze(fd.get("content").trim(), fd.get("title").trim(), null, fd.get("assignedTo"), cfg.sourceType);
  });
}

async function uploadAndAnalyze(text, title, filename, assignedTo, sourceType = "call") {
  if (!text || text.length < 20) {
    alert("Text is too short to analyze.");
    return;
  }
  const assigneeId = assignedTo || getSelectedTranscriptAssignee();
  content.innerHTML = '<div class="empty-state"><p>Uploading and analyzing…</p></div>';
  try {
    const normalized = normalizeTranscriptText(text);
    const record = await transcriptsDB.upload({
      title: title || (sourceType === "linkedin" ? "LinkedIn conversation" : "Call transcript"),
      filename,
      content: normalized,
      assignedTo: assigneeId,
      sourceType,
    });
    await transcriptsDB.process(record.id);
    render();
  } catch (e) {
    alert("Failed: " + (e.message || e));
    render();
  }
}

// ── Team dashboard ──

async function renderTeam() {
  const stats = await getTeamStats();
  const teamData = getTeam();

  content.innerHTML = `
    <div class="team-header card" style="padding:1.25rem;margin-bottom:1.5rem">
      <h3 style="margin-bottom:0.25rem">${escapeHtml(teamData?.name || "Team")}</h3>
      <p class="task-meta">Invite code: <code class="invite-code">${escapeHtml(teamData?.invite_code || "")}</code>
        <button class="btn btn-sm btn-secondary" id="copy-invite" style="margin-left:0.5rem">Copy</button>
      </p>
      <p class="task-meta" style="margin-top:0.35rem">Share this code so new members can join when they sign up.</p>
    </div>
    <div class="card">
      <div class="card-header">Team leaderboard — last 30 days</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Rank</th><th>Member</th><th>Activity</th><th>Contacts</th><th>Open deals</th><th>Pipeline</th><th>Won</th><th>Tasks done</th><th></th></tr></thead>
          <tbody>${stats.map((s, i) => `
            <tr>
              <td><strong>#${i + 1}</strong>${i === 0 ? " 🏆" : ""}</td>
              <td><div class="contact-cell"><span class="avatar">${initials(s.member.full_name)}</span>${escapeHtml(s.member.full_name)}${s.member.role === "admin" ? " ★" : ""}</div></td>
              <td><strong>${s.activityScore}</strong> actions</td>
              <td>${s.contacts}</td>
              <td>${s.openDeals}</td>
              <td>${formatCurrency(s.pipeline)}</td>
              <td>${formatCurrency(s.won)}</td>
              <td>${s.tasksDone}/${s.tasksTotal}</td>
              <td><button class="btn btn-sm btn-secondary" data-view-member="${s.member.id}">View CRM</button></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;

  document.getElementById("copy-invite")?.addEventListener("click", () => {
    navigator.clipboard.writeText(teamData.invite_code);
    document.getElementById("copy-invite").textContent = "Copied!";
    setTimeout(() => { document.getElementById("copy-invite").textContent = "Copy"; }, 2000);
  });

  content.querySelectorAll("[data-view-member]").forEach((b) => b.addEventListener("click", () => {
    setViewingUserId(b.dataset.viewMember);
    renderMemberTabs();
    navigate("dashboard");
  }));

  topbarActions.innerHTML = "";
}

// Router uses renderView() above
function render() {
  return renderView();
}
