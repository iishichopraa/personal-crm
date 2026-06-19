let pipelineStages = [];

const PRESET_TEAMS = [
  { slug: "ploid", name: "Ploid Overall", description: "Company-wide workspace — default for new sign-ins", icon: "◆" },
  { slug: "devs", name: "Devs", description: "Engineering and product", icon: "⌨" },
  { slug: "sonia", name: "Sonia Team", description: "Sonia's squad", icon: "S" },
  { slug: "kevin", name: "Kevin Team", description: "Kevin's squad", icon: "K" },
];
const DEFAULT_TEAM_SLUG = "ploid";
const PRESET_TEAM_SLUGS = PRESET_TEAMS.map((t) => t.slug);

function presetTeamSelectOptions(selectedSlug = DEFAULT_TEAM_SLUG) {
  return PRESET_TEAMS.map(
    (t) => `<option value="${t.slug}"${t.slug === selectedSlug ? " selected" : ""}>${t.name}</option>`
  ).join("");
}

function ploidBrandHTML() {
  return `<div class="ploid-brand">
    <img src="/assets/ploid-icon.png" alt="" class="ploid-icon" />
    <span class="ploid-wordmark">Ploid</span>
  </div>`;
}

const DEFAULT_PIPELINE = [
  { name: "Lead", sort_order: 0, entry_criteria: "New lead", exit_criteria: "Qualified", is_closed: false, is_won: false, stale_days: 7 },
  { name: "Qualified", sort_order: 1, entry_criteria: "Need confirmed", exit_criteria: "Proposal sent", is_closed: false, is_won: false, stale_days: 10 },
  { name: "Proposal", sort_order: 2, entry_criteria: "Proposal delivered", exit_criteria: "Decision", is_closed: false, is_won: false, stale_days: 14 },
  { name: "Won", sort_order: 3, is_closed: true, is_won: true, stale_days: 999 },
  { name: "Lost", sort_order: 4, is_closed: true, is_won: false, stale_days: 999 },
];

async function loadPipelineStages() {
  if (!team) { pipelineStages = DEFAULT_PIPELINE; return pipelineStages; }
  const sb = getSupabase();
  const { data, error } = await sb.from("pipeline_stages").select("*").eq("team_id", team.id).order("sort_order");
  pipelineStages = error || !data?.length ? DEFAULT_PIPELINE : data;
  return pipelineStages;
}

function getPipelineStages() { return pipelineStages.length ? pipelineStages : DEFAULT_PIPELINE; }
function getOpenStages() { return getPipelineStages().filter((s) => !s.is_closed); }
function getStageMeta(name) { return getPipelineStages().find((s) => s.name === name); }

function daysInStage(deal) {
  const entered = deal.stageEnteredAt ? new Date(deal.stageEnteredAt) : new Date(deal.createdAt);
  return Math.floor((Date.now() - entered.getTime()) / 86400000);
}

function isDealStale(deal) {
  const meta = getStageMeta(deal.stage);
  if (!meta || meta.is_closed) return false;
  return daysInStage(deal) >= (meta.stale_days || 14);
}

async function logTimeline({ eventType, title, body, contactId, companyId, dealId, meta = {} }) {
  if (!session || !team) return;
  const sb = getSupabase();
  await sb.from("timeline_events").insert({
    team_id: team.id,
    user_id: session.user.id,
    contact_id: contactId || null,
    company_id: companyId || null,
    deal_id: dealId || null,
    event_type: eventType,
    title,
    body: body || "",
    meta,
  });
}

async function runWorkflows(triggerType, context = {}) {
  if (!team) return;
  const sb = getSupabase();
  const { data: rules } = await sb.from("workflow_rules").select("*").eq("team_id", team.id).eq("trigger_type", triggerType).eq("enabled", true);
  for (const rule of rules || []) {
    const cfg = rule.trigger_config || {};
    if (triggerType === "deal_stage_change" && cfg.to_stage && cfg.to_stage !== context.stage) continue;
    const action = rule.action_config || {};
    if (rule.action_type === "create_task") {
      const due = new Date();
      due.setDate(due.getDate() + (action.due_days || 1));
      await tasksDB.save({
        title: action.title || "Automated follow-up",
        dueDate: due.toISOString().slice(0, 10),
        contactId: context.contactId || null,
        dealId: context.dealId || null,
        done: false,
      });
    } else if (rule.action_type === "timeline_log") {
      await logTimeline({
        eventType: "system",
        title: action.title || rule.name,
        body: action.body || "",
        contactId: context.contactId,
        companyId: context.companyId,
        dealId: context.dealId,
      });
    } else if (rule.action_type === "set_next_action") {
      if (context.dealId) {
        await sb.from("deals").update({ next_action: action.text || "Follow up" }).eq("id", context.dealId);
      }
    }
  }
}

const companiesDB = {
  async all() {
    if (!team?.id) return [];
    const sb = getSupabase();
    const { data, error } = await sb.from("companies").select("*").eq("team_id", team.id).order("name");
    if (error) throw error;
    return data || [];
  },
  async get(id) {
    if (!team?.id) throw new Error("Create or join a team to manage companies");
    const sb = getSupabase();
    const { data, error } = await sb.from("companies").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  },
  async save(company) {
    if (!team?.id) throw new Error("Create or join a team to manage companies");
    const sb = getSupabase();
    const payload = {
      team_id: team.id,
      name: company.name,
      domain: company.domain || "",
      industry: company.industry || "",
      notes: company.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (company.id) {
      const { data, error } = await sb.from("companies").update(payload).eq("id", company.id).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await sb.from("companies").insert(payload).select().single();
    if (error) throw error;
    await logTimeline({ eventType: "system", title: `Company created: ${data.name}`, companyId: data.id });
    return data;
  },
  async getOrCreateByName(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const existing = (await companiesDB.all()).find((co) => co.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    return companiesDB.save({ name: trimmed });
  },
  async contacts(companyId) {
    const sb = getSupabase();
    const { data } = await sb.from("contacts").select("*").eq("company_id", companyId).order("name");
    return data || [];
  },
  async deals(companyId) {
    const sb = getSupabase();
    const { data } = await sb.from("deals").select("*").eq("company_id", companyId);
    return data || [];
  },
};

const timelineDB = {
  async forContact(contactId) {
    const sb = getSupabase();
    const { data } = await sb.from("timeline_events").select("*, profiles(full_name)").eq("contact_id", contactId).order("created_at", { ascending: false });
    return data || [];
  },
  async forCompany(companyId) {
    const sb = getSupabase();
    const { data } = await sb.from("timeline_events").select("*, profiles(full_name)").eq("company_id", companyId).order("created_at", { ascending: false });
    return data || [];
  },
  async logActivity(eventType, title, body, { contactId, companyId, dealId } = {}) {
    await logTimeline({ eventType, title, body, contactId, companyId, dealId });
  },
};

const integrationsDB = {
  async all() {
    const sb = getSupabase();
    const { data } = await sb.from("team_integrations").select("*").eq("team_id", team.id);
    return data || [];
  },
  async toggle(provider, enabled) {
    const sb = getSupabase();
    await sb.from("team_integrations").update({ enabled }).eq("team_id", team.id).eq("provider", provider);
  },
};

const workflowsDB = {
  async all() {
    const sb = getSupabase();
    const { data } = await sb.from("workflow_rules").select("*").eq("team_id", team.id).order("created_at");
    return data || [];
  },
  async toggle(id, enabled) {
    const sb = getSupabase();
    await sb.from("workflow_rules").update({ enabled }).eq("id", id);
  },
};

function timelineIcon(type) {
  return { call: "☎", email: "✉", meeting: "📅", note: "📝", task: "✓", deal: "$", file: "📎", ticket: "🎫", system: "⚙" }[type] || "•";
}

function renderTimelineHTML(events) {
  if (!events.length) return '<div class="empty-state"><p>No activity logged yet</p></div>';
  return `<ul class="timeline-feed">${events.map((e) => `
    <li class="timeline-item">
      <span class="timeline-icon">${timelineIcon(e.event_type)}</span>
      <div class="timeline-content">
        <strong>${escapeHtml(e.title)}</strong>
        ${e.body ? `<p>${escapeHtml(e.body)}</p>` : ""}
        <span class="timeline-meta">${escapeHtml(e.profiles?.full_name || "Team")} · ${formatDateTime(e.created_at)}</span>
      </div>
    </li>`).join("")}</ul>`;
}

async function getReportMetrics() {
  if (!team?.id) {
    return { openCount: 0, pipelineValue: 0, wonValue: 0, winRate: 0, staleCount: 0, tasksDone: 0, activityCount: 0, contacts: 0, velocity: 0 };
  }
  const uid = getViewingUserId();
  const sb = getSupabase();
  const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const [deals, tasks, contacts, activitiesRes] = await Promise.all([
    dealsDB.all(uid),
    tasksDB.all(uid),
    directoryDB.all(),
    sb.from("activities").select("id", { count: "exact", head: true }).eq("team_id", team.id).gte("created_at", sinceIso),
  ]);
  const dealList = deals;
  const open = dealList.filter((d) => !getStageMeta(d.stage)?.is_closed);
  const won = dealList.filter((d) => getStageMeta(d.stage)?.is_won);
  const stale = open.filter(isDealStale);
  const completedTasks = tasks.filter((t) => t.done);
  const velocity = won.length ? Math.round(won.reduce((s, d) => s + daysInStage(d), 0) / won.length) : 0;
  return {
    openCount: open.length,
    pipelineValue: open.reduce((s, d) => s + Number(d.amount || 0), 0),
    wonValue: won.reduce((s, d) => s + Number(d.amount || 0), 0),
    winRate: dealList.length ? Math.round((won.length / dealList.length) * 100) : 0,
    staleCount: stale.length,
    tasksDone: completedTasks.length,
    activityCount: activitiesRes.count || 0,
    contacts: contacts.length,
    velocity,
  };
}
