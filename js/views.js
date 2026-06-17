// ── Companies & Customer 360 ──

async function renderCompanies() {
  if (typeof hasTeam === "function" && !hasTeam()) {
    content.innerHTML = `
      <div class="page-banner" style="background:#fef3c7;color:#92400e">
        <strong>Team workspace required</strong>
        <span>Companies are shared across your team. Create a team or join with an invite code to continue.</span>
      </div>
      <div class="empty-state"><p>Reload the page if you just finished team setup.</p></div>`;
    topbarActions.innerHTML = "";
    return;
  }
  const [companies, allContacts] = await Promise.all([companiesDB.all(), directoryDB.all()]);
  const contactCounts = {};
  allContacts.forEach((c) => { if (c.companyId) contactCounts[c.companyId] = (contactCounts[c.companyId] || 0) + 1; });

  content.innerHTML = `
    ${readOnlyBanner()}
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Company</th><th>Industry</th><th>Contacts</th><th></th></tr></thead>
          <tbody>${companies.length === 0
            ? '<tr><td colspan="4"><div class="empty-state"><p>No companies yet — add one to group contacts</p></div></td></tr>'
            : companies.map((co) => `<tr>
              <td><strong>${escapeHtml(co.name)}</strong><div class="task-meta">${escapeHtml(co.domain || "")}</div></td>
              <td>${escapeHtml(co.industry || "—")}</td>
              <td>${contactCounts[co.id] || 0}</td>
              <td><button class="btn btn-sm btn-secondary" data-company-360="${co.id}">360 view</button>
              ${canEdit() ? `<button class="btn btn-sm btn-secondary" data-edit-company="${co.id}">Edit</button>` : ""}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;

  content.querySelectorAll("[data-company-360]").forEach((b) => b.addEventListener("click", () => openCompany360(b.dataset.company360)));
  content.querySelectorAll("[data-edit-company]").forEach((b) => b.addEventListener("click", () => openCompanyForm(b.dataset.editCompany)));
  topbarActions.innerHTML = "";
  if (canEdit()) topbarActions.appendChild(btn("+ Add company", "btn btn-primary", () => openCompanyForm()));
}

async function openCompany360(companyId) {
  const [co, contacts, deals, events] = await Promise.all([
    companiesDB.get(companyId),
    companiesDB.contacts(companyId),
    companiesDB.deals(companyId),
    timelineDB.forCompany(companyId),
  ]);

  openModal(co.name, `
    <div class="grid-2" style="margin-bottom:1rem">
      <div><strong>Domain</strong><p class="task-meta">${escapeHtml(co.domain || "—")}</p></div>
      <div><strong>Industry</strong><p class="task-meta">${escapeHtml(co.industry || "—")}</p></div>
    </div>
    <div class="form-group"><label>Contacts (${contacts.length})</label>
      ${contacts.length ? `<ul class="mini-list">${contacts.map((c) => `<li>${escapeHtml(c.name)} · ${escapeHtml(c.email || "")}</li>`).join("")}</ul>` : "<p class='task-meta'>No contacts linked</p>"}
    </div>
    <div class="form-group"><label>Open deals (${deals.filter((d) => !getStageMeta(d.stage)?.is_closed).length})</label>
      ${deals.length ? `<ul class="mini-list">${deals.map((d) => `<li>${escapeHtml(d.title)} · ${escapeHtml(d.stage)} · ${formatCurrency(d.amount)}</li>`).join("")}</ul>` : "<p class='task-meta'>No deals</p>"}
    </div>
    ${canEdit() ? `<div class="quick-log-bar">
      <button type="button" class="btn btn-sm btn-secondary" data-log="call" data-co="${companyId}">Log call</button>
      <button type="button" class="btn btn-sm btn-secondary" data-log="email" data-co="${companyId}">Log email</button>
      <button type="button" class="btn btn-sm btn-secondary" data-log="meeting" data-co="${companyId}">Log meeting</button>
    </div>` : ""}
    <div class="form-group"><label>Activity timeline</label>${renderTimelineHTML(events)}</div>
    <input type="hidden" name="noop" value="1" />
  `, () => closeModal());

  modalBody.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => openQuickLog(b.dataset.log, { companyId: b.dataset.co })));
}

function openCompanyForm(id) {
  const load = id ? companiesDB.get(id) : Promise.resolve({});
  load.then((co) => {
    openModal(id ? "Edit company" : "New company", `
      <div class="form-group"><label>Name *</label><input name="name" required value="${escapeHtml(co.name || "")}" /></div>
      <div class="form-row">
        <div class="form-group"><label>Domain</label><input name="domain" value="${escapeHtml(co.domain || "")}" placeholder="acme.com" /></div>
        <div class="form-group"><label>Industry</label><input name="industry" value="${escapeHtml(co.industry || "")}" /></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes">${escapeHtml(co.notes || "")}</textarea></div>
      <input type="hidden" name="id" value="${co.id || ""}" />
    `, async (fd) => {
      await companiesDB.save({ id: fd.get("id") || undefined, name: fd.get("name").trim(), domain: fd.get("domain").trim(), industry: fd.get("industry").trim(), notes: fd.get("notes").trim() });
      closeModal(); render();
    });
  });
}

function openQuickLog(type, { contactId, companyId, dealId } = {}) {
  openModal(`Log ${type}`, `
    <div class="form-group"><label>Summary *</label><input name="title" required placeholder="Brief summary of the ${type}" /></div>
    <div class="form-group"><label>Details</label><textarea name="body" placeholder="Notes, outcomes, next steps…"></textarea></div>
    <input type="hidden" name="noop" value="1" />
  `, async (fd) => {
    await timelineDB.logActivity(type, fd.get("title").trim(), fd.get("body").trim(), { contactId, companyId, dealId });
    closeModal();
    if (currentView === "companies") openCompany360(companyId);
    else if (contactId) openContactDetail(contactId);
    else render();
  });
}

// ── Drag-and-drop pipeline ──

async function renderDealsPipeline() {
  if (!canAccessView("deals")) { content.innerHTML = '<div class="empty-state"><p>Your role does not have access to deals.</p></div>'; return; }
  const [deals, contacts, stages] = await Promise.all([dealsDB.all(), contactsDB.all(), Promise.resolve(getPipelineStages())]);
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));

  content.innerHTML = `
    ${readOnlyBanner()}
    ${!canEditDeals() ? '<div class="readonly-banner">View-only — sales role required to move deals</div>' : ""}
    <div class="pipeline">${stages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage.name);
      return `<div class="pipeline-col" data-stage="${escapeHtml(stage.name)}">
        <div class="pipeline-col-header">${escapeHtml(stage.name)}<span class="pipeline-count">${stageDeals.length}</span></div>
        ${stage.entry_criteria ? `<div class="stage-criteria">Entry: ${escapeHtml(stage.entry_criteria)}</div>` : ""}
        <div class="pipeline-cards" data-drop-stage="${escapeHtml(stage.name)}">
          ${stageDeals.map((d) => dealCardHTML(d, contactMap, stage)).join("")}
        </div>
      </div>`;
    }).join("")}</div>`;

  if (canEditDeals()) bindDealDragDrop();
  content.querySelectorAll(".deal-card").forEach((card) => {
    card.addEventListener("click", () => openDealForm(card.dataset.id));
  });
  topbarActions.innerHTML = "";
  if (canEditDeals()) topbarActions.appendChild(btn("+ Add deal", "btn btn-primary", () => openDealForm()));
}

function dealCardHTML(deal, contactMap, stageMeta) {
  const contact = deal.contactId ? contactMap[deal.contactId] : null;
  const stale = isDealStale(deal);
  const days = daysInStage(deal);
  return `<div class="deal-card ${canEditDeals() ? "" : "deal-card-readonly"} ${stale ? "deal-stale" : ""}" data-id="${deal.id}" draggable="${canEditDeals() ? "true" : "false"}">
    <div class="deal-card-title">${escapeHtml(deal.title)}</div>
    <div class="deal-card-meta">${contact ? escapeHtml(contact.name) : "No contact"} · ${days}d in stage</div>
    <div class="deal-card-amount">${formatCurrency(deal.amount)}</div>
    ${deal.nextAction ? `<div class="deal-next-action">Next: ${escapeHtml(deal.nextAction)}</div>` : ""}
    ${stale ? '<span class="badge badge-lost">Stale</span>' : ""}
  </div>`;
}

function bindDealDragDrop() {
  let draggedId = null;
  content.querySelectorAll(".deal-card[draggable=true]").forEach((card) => {
    card.addEventListener("dragstart", (e) => { draggedId = card.dataset.id; e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });
  content.querySelectorAll("[data-drop-stage]").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      if (!draggedId) return;
      const newStage = zone.dataset.dropStage;
      const deal = await dealsDB.get(draggedId);
      if (deal.stage === newStage) return;
      await dealsDB.save({ ...deal, stage: newStage });
      render();
    });
  });
}

// ── Reports ──

async function renderReports() {
  const [m, deals] = await Promise.all([getReportMetrics(), dealsDB.all()]);
  const stages = getOpenStages();
  const stageCounts = stages.map((s) => ({
    name: s.name,
    count: deals.filter((d) => d.stage === s.name).length,
  }));
  const maxCount = Math.max(1, ...stageCounts.map((s) => s.count));

  content.innerHTML = `
    <div class="page-banner reports-banner">
      <strong>📊 Reports & Analytics</strong>
      <span>Pipeline health, deal velocity, and team performance</span>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Win rate</div><div class="value">${m.winRate}%</div></div>
      <div class="stat-card"><div class="label">Pipeline</div><div class="value">${formatCurrency(m.pipelineValue)}</div><div class="sub">${m.openCount} open deals</div></div>
      <div class="stat-card"><div class="label">Won (all time)</div><div class="value">${formatCurrency(m.wonValue)}</div></div>
      <div class="stat-card"><div class="label">Stale deals</div><div class="value">${m.staleCount}</div><div class="sub">Need attention</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header">Pipeline health by stage</div>
        <div class="card-body" style="padding:1rem 1.25rem">
          ${stageCounts.map((s) => `
            <div class="bar-row">
              <span>${escapeHtml(s.name)} (${s.count})</span>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round((s.count / maxCount) * 100)}%"></div></div>
            </div>`).join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-header">Team activity (30 days)</div>
        <div class="card-body" style="padding:1.25rem">
          <p><strong>${m.activityCount}</strong> logged actions</p>
          <p style="margin-top:0.5rem"><strong>${m.tasksDone}</strong> tasks completed</p>
          <p style="margin-top:0.5rem"><strong>${m.contacts}</strong> contacts in workspace</p>
          <p style="margin-top:0.5rem"><strong>${m.velocity}</strong> avg days to close (won deals)</p>
        </div>
      </div>
    </div>`;
  topbarActions.innerHTML = "";
}

// ── Settings (admin) ──

async function renderSettings() {
  const [stages, workflows, integrations] = await Promise.all([
    Promise.resolve(getPipelineStages()),
    workflowsDB.all(),
    integrationsDB.all(),
  ]);

  content.innerHTML = `
    <div class="settings-grid">
      <div class="card">
        <div class="card-header">Pipeline stages</div>
        <div class="card-body">${stages.map((s) => `
          <div class="settings-row">
            <strong>${escapeHtml(s.name)}</strong>
            <span class="task-meta">Stale after ${s.stale_days}d · ${s.is_closed ? "Closed" : "Open"}</span>
            ${s.entry_criteria ? `<div class="task-meta">Entry: ${escapeHtml(s.entry_criteria)}</div>` : ""}
            ${s.exit_criteria ? `<div class="task-meta">Exit: ${escapeHtml(s.exit_criteria)}</div>` : ""}
          </div>`).join("")}</div>
      </div>
      <div class="card">
        <div class="card-header">Workflow automation</div>
        <div class="card-body">${workflows.map((w) => `
          <div class="settings-row flex-between">
            <div><strong>${escapeHtml(w.name)}</strong><div class="task-meta">${escapeHtml(w.trigger_type)} → ${escapeHtml(w.action_type)}</div></div>
            <label class="toggle"><input type="checkbox" data-workflow="${w.id}" ${w.enabled ? "checked" : ""} /> On</label>
          </div>`).join("")}</div>
      </div>
      <div class="card">
        <div class="card-header">Integrations</div>
        <div class="card-body">${integrations.map((i) => `
          <div class="settings-row flex-between">
            <div><strong>${escapeHtml(i.provider)}</strong><div class="task-meta">${i.enabled ? "Connected (placeholder)" : "Not connected — API key required"}</div></div>
            <button class="btn btn-sm btn-secondary" data-integration="${i.provider}">${i.enabled ? "Disable" : "Enable"}</button>
          </div>`).join("")}
        <p class="task-meta" style="padding:0.75rem 1.25rem">Gmail, Slack, Calendar, and Zoom connectors store config here. Full OAuth sync coming next.</p>
      </div>
      <div class="card">
        <div class="card-header">Roles</div>
        <div class="card-body">${getMembers().map((m) => `
          <div class="settings-row flex-between">
            <span>${escapeHtml(m.full_name)}</span>
            <span class="badge badge-qualified">${roleLabel(m.role)}</span>
          </div>`).join("")}</div>
      </div>
    </div>`;

  content.querySelectorAll("[data-workflow]").forEach((cb) => cb.addEventListener("change", async () => {
    await workflowsDB.toggle(cb.dataset.workflow, cb.checked);
  }));
  content.querySelectorAll("[data-integration]").forEach((b) => b.addEventListener("click", async () => {
    const row = integrations.find((i) => i.provider === b.dataset.integration);
    await integrationsDB.toggle(b.dataset.integration, !row?.enabled);
    renderSettings();
  }));
  topbarActions.innerHTML = "";
}
