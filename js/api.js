const DEAL_STAGES = ["Lead", "Qualified", "Proposal", "Won", "Lost"];

let supabaseClient = null;
let session = null;
let profile = null;
let team = null;
let members = [];
let viewingUserId = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const cfg = window.CRM_CONFIG;
  if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes("YOUR_PROJECT")) {
    return null;
  }
  supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return supabaseClient;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out — check your internet or Supabase project status`)), ms)
    ),
  ]);
}

function isConfigured() {
  return !!getSupabase();
}

function getSession() {
  return session;
}

function getProfile() {
  return profile;
}

function getTeam() {
  return team;
}

function getMembers() {
  return members;
}

function isAdmin() {
  return profile?.role === "admin";
}

function getViewingUserId() {
  return viewingUserId || session?.user?.id;
}

function setViewingUserId(userId) {
  viewingUserId = userId;
}

async function loadSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await withTimeout(sb.auth.getSession(), 8000, "Connection");
  if (error) throw error;
  session = data.session;
  return session;
}

async function loadProfile() {
  const sb = getSupabase();
  if (!session?.user?.id) return null;
  const uid = session.user.id;
  const { data: prof, error } = await withTimeout(
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    8000,
    "Profile load"
  );
  if (error) throw error;
  profile = prof;
  if (prof?.team_id) {
    const { data: t, error: teamErr } = await withTimeout(
      sb.from("teams").select("*").eq("id", prof.team_id).maybeSingle(),
      8000,
      "Team load"
    );
    if (teamErr) throw teamErr;
    team = t;
    const { data: mems, error: memErr } = await withTimeout(
      sb.from("profiles").select("*").eq("team_id", prof.team_id).order("full_name"),
      8000,
      "Team members load"
    );
    if (memErr) throw memErr;
    members = mems || [];
  } else {
    team = null;
    members = [];
  }
  if (!viewingUserId || !members.find((m) => m.id === viewingUserId)) {
    viewingUserId = uid;
  }
  await loadPipelineStages();
  return profile;
}

async function signIn(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw formatAuthError(error);
  session = data.session;
  await loadProfile();
  return session;
}

function formatAuthError(error) {
  const msg = error?.message || "Something went wrong";
  if (/email not confirmed/i.test(msg)) {
    return new Error("Sign-in blocked by email confirmation. In Supabase → Authentication → Providers → Email, turn off Confirm email.");
  }
  return error;
}

function hasTeam() {
  return !!(team?.id || profile?.team_id);
}

async function createTeam(teamName) {
  if (!session?.user?.id) throw new Error("Not signed in");
  const name = teamName?.trim();
  if (!name) throw new Error("Enter a team name");
  const sb = getSupabase();
  const { data: newTeam, error: teamErr } = await sb
    .from("teams")
    .insert({ name, owner_id: session.user.id })
    .select()
    .single();
  if (teamErr) throw teamErr;
  const { error: profErr } = await sb
    .from("profiles")
    .update({ team_id: newTeam.id, role: "admin" })
    .eq("id", session.user.id);
  if (profErr) throw profErr;
  await loadProfile();
  return newTeam;
}

async function joinTeam(inviteCode) {
  if (!session?.user?.id) throw new Error("Not signed in");
  const code = inviteCode?.trim();
  if (!code) throw new Error("Enter an invite code");
  const sb = getSupabase();
  const { data: joinTeamRow, error: findErr } = await sb
    .from("teams")
    .select("*")
    .eq("invite_code", code)
    .single();
  if (findErr || !joinTeamRow) throw new Error("Invalid invite code");
  const { error: profErr } = await sb
    .from("profiles")
    .update({ team_id: joinTeamRow.id, role: "member" })
    .eq("id", session.user.id);
  if (profErr) throw profErr;
  await loadProfile();
  return joinTeamRow;
}

async function signUp(email, password, fullName, { teamName, inviteCode } = {}) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  session = data.session;
  if (!session) {
    const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    if (signInErr) throw formatAuthError(signInErr);
    session = signInData.session;
  }
  await loadProfile();

  if (teamName) {
    await createTeam(teamName);
    if (fullName) {
      await sb.from("profiles").update({ full_name: fullName }).eq("id", session.user.id);
      await loadProfile();
    }
  } else if (inviteCode) {
    await joinTeam(inviteCode);
    if (fullName) {
      await sb.from("profiles").update({ full_name: fullName }).eq("id", session.user.id);
      await loadProfile();
    }
  }

  return session;
}

async function signOut() {
  const sb = getSupabase();
  await sb.auth.signOut();
  session = null;
  profile = null;
  team = null;
  members = [];
  viewingUserId = null;
}

async function logActivity(action, entityType, entityId, meta = {}) {
  if (!session || !team) return;
  const sb = getSupabase();
  await sb.from("activities").insert({
    user_id: session.user.id,
    team_id: team.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    meta,
  });
}

function mapContact(row) {
  return {
    id: row.id,
    userId: row.user_id,
    directoryPersonId: row.directory_person_id,
    ownerName: row.profiles?.full_name || "",
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    companyId: row.company_id,
    nextAction: row.next_action,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapDirectoryPerson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    companyId: row.company_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function parseContactMeta(notes = "") {
  const title = notes.match(/Title:\s*([^|]+)/)?.[1]?.trim() || "";
  const owner = notes.match(/Tags:\s*Owner:\s*([^|]+)/)?.[1]?.trim()
    || notes.match(/Owner:\s*([^|]+)/)?.[1]?.trim()
    || "";
  return { title, owner };
}

function mapDeal(row) {
  return {
    id: row.id,
    userId: row.user_id,
    contactId: row.contact_id,
    companyId: row.company_id,
    title: row.title,
    amount: row.amount,
    stage: row.stage,
    stageEnteredAt: row.stage_entered_at,
    nextAction: row.next_action,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    userId: row.user_id,
    contactId: row.contact_id,
    dealId: row.deal_id,
    title: row.title,
    description: row.description || "",
    dueDate: row.due_date,
    done: row.done,
    assignedTo: row.assigned_to || null,
    transcriptId: row.transcript_id || null,
    sourceStepIndex: row.source_step_index ?? null,
    createdAt: row.created_at,
  };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inferDueDate(text, importance) {
  const lower = (text || "").toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (/meet(ing)?|schedule(d| a)?|calendar|zoom|teams|google meet|video call|call (at|on)|coffee chat|sync up|book (a|time)/i.test(lower)) {
    if (/tomorrow/i.test(lower)) return toDateInputValue(addDays(today, 1));
    if (/next week/i.test(lower)) return toDateInputValue(addDays(today, 7));
    return toDateInputValue(addDays(today, importance === "high" ? 1 : 2));
  }
  if (/today|asap|urgent|immediately/i.test(lower)) return toDateInputValue(today);
  if (/tomorrow/i.test(lower)) return toDateInputValue(addDays(today, 1));
  if (/this week|by friday|end of week/i.test(lower)) return toDateInputValue(addDays(today, 4));
  if (/next week/i.test(lower)) return toDateInputValue(addDays(today, 7));
  const offset = { high: 1, medium: 3, low: 5 }[importance] || 3;
  return toDateInputValue(addDays(today, offset));
}

function buildTaskDescription({ transcriptTitle, callSummary, stepText, sourceType = "call" }) {
  const sourceLabel = sourceType === "linkedin" ? "LinkedIn conversation" : "Call";
  const parts = [];
  if (transcriptTitle) parts.push(`${sourceLabel}: ${transcriptTitle}`);
  if (callSummary) parts.push(`\nSummary:\n${callSummary}`);
  if (stepText) parts.push(`\nWhat to do:\n${stepText}`);
  return parts.join("\n").trim();
}

function buildTranscriptTaskSteps(transcript) {
  const card = buildTranscriptCardData(transcript);
  const summaryText = card.summaryLines.join("\n");
  const sourceType = transcript.sourceType || "call";
  return card.nextSteps.map((step, index) => ({
    index,
    title: step.topic || summarizeAsTitle(step.text, 58) || `Follow up ${index + 1}`,
    stepText: step.text,
    contactId: step.contactId || null,
    importance: step.importance || "medium",
    dueDate: inferDueDate(step.text, step.importance),
    description: buildTaskDescription({
      transcriptTitle: transcript.title,
      callSummary: summaryText,
      stepText: step.text,
      sourceType,
    }),
  }));
}

function conversationImportanceScore(transcript) {
  const card = buildTranscriptCardData(transcript);
  if (!card.nextSteps.length) return 0;
  return Math.max(...card.nextSteps.map((s) => importanceScore(s.importance)));
}

function conversationTopImportance(transcript) {
  const card = buildTranscriptCardData(transcript);
  const levels = card.nextSteps.map((s) => s.importance);
  if (levels.includes("high")) return "high";
  if (levels.includes("medium")) return "medium";
  return levels.length ? "low" : "medium";
}

function sortConversationsByImportance(transcripts) {
  return [...transcripts].sort((a, b) => {
    const diff = conversationImportanceScore(b) - conversationImportanceScore(a);
    if (diff !== 0) return diff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function getMemberName(userId) {
  const member = getMembers().find((m) => m.id === userId);
  return member?.full_name || member?.email || "Team member";
}

function getExtensionConnectInfo() {
  return {
    supabaseUrl: window.CRM_CONFIG?.SUPABASE_URL || "",
    anonKey: window.CRM_CONFIG?.SUPABASE_ANON_KEY || "",
    accessToken: session?.access_token || "",
    userId: session?.user?.id || "",
    teamId: team?.id || "",
  };
}

function formatLinkedInThreadContent(thread, directoryPerson) {
  const meta = directoryPerson ? parseContactMeta(directoryPerson.notes) : { title: "", owner: "" };
  const title = meta.title || thread.headline || "";
  const company = directoryPerson?.company || thread.company || "";
  const lines = [
    `LinkedIn conversation with ${thread.name}`,
    title ? `Title: ${title}` : "",
    company ? `Company: ${company}` : "",
    meta.owner ? `Owner tag: ${meta.owner}` : "",
    thread.profileUrl ? `Profile: ${thread.profileUrl}` : "",
    thread.needsMeeting ? "Action: Meeting or call mentioned — respond to confirm." : "",
    "",
    "Messages:",
  ];
  const messages = thread.messages?.length
    ? thread.messages
    : [{ from: thread.name, text: thread.lastMessage || "" }];
  for (const m of messages) {
    if (m.text) lines.push(`${m.from}: ${m.text}`);
  }
  return lines.filter((l) => l !== "").join("\n");
}

async function enrichLinkedInThread(thread) {
  const person = await directoryDB.matchByName(thread.name);
  if (!person) return thread;
  const meta = parseContactMeta(person.notes);
  return {
    ...thread,
    company: thread.company || person.company || "",
    headline: thread.headline || meta.title || "",
    directoryId: person.id,
    email: person.email || "",
  };
}

const directoryDB = {
  async all() {
    if (!team?.id) return [];
    const sb = getSupabase();
    const { data, error } = await sb.from("directory_people").select("*").eq("team_id", team.id).order("name");
    if (error) throw error;
    return (data || []).map(mapDirectoryPerson);
  },
  async get(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from("directory_people").select("*").eq("id", id).single();
    if (error) throw error;
    return mapDirectoryPerson(data);
  },
  async matchByName(name) {
    if (!name) return null;
    const people = await directoryDB.all();
    const key = name.toLowerCase().trim();
    return people.find((p) => p.name.toLowerCase() === key)
      || people.find((p) => p.name.toLowerCase().includes(key) || key.includes(p.name.toLowerCase()))
      || null;
  },
};

const contactsDB = {
  async all(userId) {
    const sb = getSupabase();
    const uid = userId || getViewingUserId();
    const { data, error } = await sb.from("contacts").select("*").eq("user_id", uid).order("name");
    if (error) throw error;
    return (data || []).map(mapContact);
  },
  async teamAll() {
    return directoryDB.all();
  },
  async myDirectoryIds(userId) {
    const sb = getSupabase();
    const uid = userId || getViewingUserId();
    const { data, error } = await sb
      .from("contacts")
      .select("directory_person_id")
      .eq("user_id", uid)
      .not("directory_person_id", "is", null);
    if (error) throw error;
    return new Set((data || []).map((r) => r.directory_person_id));
  },
  async addFromDirectory(directoryPersonId) {
    const person = await directoryDB.get(directoryPersonId);
    const uid = getViewingUserId();
    const sb = getSupabase();
    const { data: existing } = await sb
      .from("contacts")
      .select("id")
      .eq("user_id", uid)
      .eq("directory_person_id", directoryPersonId)
      .maybeSingle();
    if (existing?.id) return contactsDB.get(existing.id);

    const { data, error } = await sb.from("contacts").insert({
      user_id: uid,
      team_id: team.id,
      directory_person_id: directoryPersonId,
      name: person.name,
      email: person.email || "",
      phone: person.phone || "",
      company: person.company || "",
      company_id: person.companyId || null,
      notes: person.notes || "",
      next_action: "",
    }).select().single();
    if (error) throw error;
    await logActivity("contact_created", "contact", data.id, { fromDirectory: true });
    return mapContact(data);
  },
  async findByDirectoryId(directoryPersonId, userId) {
    const sb = getSupabase();
    const uid = userId || getViewingUserId();
    const { data, error } = await sb
      .from("contacts")
      .select("*")
      .eq("user_id", uid)
      .eq("directory_person_id", directoryPersonId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapContact(data) : null;
  },
  async get(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from("contacts").select("*").eq("id", id).single();
    if (error) throw error;
    return mapContact(data);
  },
  async save(contact) {
    const sb = getSupabase();
    const uid = getViewingUserId();
    const isEdit = !!contact.id;
    const payload = {
      user_id: uid,
      team_id: team.id,
      name: contact.name,
      email: contact.email || "",
      phone: contact.phone || "",
      company: contact.company || "",
      company_id: contact.companyId || null,
      directory_person_id: contact.directoryPersonId || null,
      next_action: contact.nextAction || "",
      notes: contact.notes || "",
      updated_at: new Date().toISOString(),
    };
    let result;
    if (isEdit) {
      const { data, error } = await sb.from("contacts").update(payload).eq("id", contact.id).select().single();
      if (error) throw error;
      result = data;
      await logActivity("contact_updated", "contact", result.id);
    } else {
      const { data, error } = await sb.from("contacts").insert(payload).select().single();
      if (error) throw error;
      result = data;
      await logActivity("contact_created", "contact", result.id);
      await runWorkflows("contact_created", { contactId: result.id, companyId: result.company_id });
      await logTimeline({ eventType: "system", title: `Contact added: ${result.name}`, contactId: result.id, companyId: result.company_id });
    }
    return mapContact(result);
  },
  async delete(id) {
    const sb = getSupabase();
    const { error } = await sb.from("contacts").delete().eq("id", id);
    if (error) throw error;
    await logActivity("contact_deleted", "contact", id);
  },
};

const dealsDB = {
  async all(userId) {
    const sb = getSupabase();
    const uid = userId || getViewingUserId();
    const { data, error } = await sb.from("deals").select("*").eq("user_id", uid);
    if (error) throw error;
    return (data || []).map(mapDeal);
  },
  async get(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from("deals").select("*").eq("id", id).single();
    if (error) throw error;
    return mapDeal(data);
  },
  async save(deal) {
    const sb = getSupabase();
    const uid = getViewingUserId();
    const payload = {
      user_id: uid,
      team_id: team.id,
      contact_id: deal.contactId || null,
      company_id: deal.companyId || null,
      title: deal.title,
      amount: deal.amount ?? 0,
      stage: deal.stage,
      next_action: deal.nextAction || "",
      notes: deal.notes || "",
      updated_at: new Date().toISOString(),
    };
    let result;
    if (deal.id) {
      const old = await dealsDB.get(deal.id);
      if (old.stage !== deal.stage) payload.stage_entered_at = new Date().toISOString();
      const { data, error } = await sb.from("deals").update(payload).eq("id", deal.id).select().single();
      if (error) throw error;
      result = data;
      if (old.stage !== deal.stage) {
        await logActivity("deal_stage_changed", "deal", result.id, { from: old.stage, to: deal.stage });
        await logTimeline({ eventType: "deal", title: `Deal moved to ${deal.stage}`, dealId: result.id, contactId: result.contact_id, companyId: result.company_id, body: deal.title });
        await runWorkflows("deal_stage_change", { stage: deal.stage, dealId: result.id, contactId: result.contact_id, companyId: result.company_id });
      } else {
        await logActivity("deal_updated", "deal", result.id);
      }
    } else {
      payload.stage_entered_at = new Date().toISOString();
      const { data, error } = await sb.from("deals").insert(payload).select().single();
      if (error) throw error;
      result = data;
      await logActivity("deal_created", "deal", result.id);
      await runWorkflows("deal_created", { dealId: result.id, stage: deal.stage, contactId: result.contact_id });
      await logTimeline({ eventType: "deal", title: `Deal created: ${deal.title}`, dealId: result.id, contactId: result.contact_id });
    }
    return mapDeal(result);
  },
  async delete(id) {
    const sb = getSupabase();
    const { error } = await sb.from("deals").delete().eq("id", id);
    if (error) throw error;
    await logActivity("deal_deleted", "deal", id);
  },
};

const tasksDB = {
  async all(userId) {
    const sb = getSupabase();
    const uid = userId || getViewingUserId();
    const { data, error } = await sb
      .from("tasks")
      .select("*")
      .eq("team_id", team.id)
      .or(`assigned_to.eq.${uid},and(assigned_to.is.null,user_id.eq.${uid})`)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data || []).map(mapTask);
  },
  async get(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from("tasks").select("*").eq("id", id).single();
    if (error) throw error;
    return mapTask(data);
  },
  async save(task) {
    const sb = getSupabase();
    const creatorId = session?.user?.id;
    const payload = {
      team_id: team.id,
      contact_id: task.contactId || null,
      deal_id: task.dealId || null,
      title: task.title,
      description: task.description || "",
      due_date: task.dueDate || null,
      done: !!task.done,
      assigned_to: task.assignedTo || null,
      transcript_id: task.transcriptId || null,
      source_step_index: task.sourceStepIndex ?? null,
      updated_at: new Date().toISOString(),
    };
    let result;
    if (task.id) {
      const { data, error } = await sb.from("tasks").update(payload).eq("id", task.id).select().single();
      if (error) throw error;
      result = data;
      if (task.done) await logActivity("task_completed", "task", result.id);
      else await logActivity("task_updated", "task", result.id);
    } else {
      payload.user_id = creatorId;
      const { data, error } = await sb.from("tasks").insert(payload).select().single();
      if (error) throw error;
      result = data;
      await logActivity("task_created", "task", result.id);
    }
    return mapTask(result);
  },
  async delete(id) {
    const sb = getSupabase();
    const { error } = await sb.from("tasks").delete().eq("id", id);
    if (error) throw error;
    await logActivity("task_deleted", "task", id);
  },
  async syncFromTranscript(transcript, assigneeId) {
    if (!assigneeId || !transcript?.id) return [];
    const steps = buildTranscriptTaskSteps(transcript);
    if (!steps.length) return [];

    const sb = getSupabase();
    const { data: existingRows, error: existingError } = await sb
      .from("tasks")
      .select("source_step_index")
      .eq("transcript_id", transcript.id)
      .eq("assigned_to", assigneeId);
    if (existingError) throw existingError;

    const existing = new Set((existingRows || []).map((r) => r.source_step_index));
    const created = [];
    for (const step of steps) {
      if (existing.has(step.index)) continue;
      created.push(await tasksDB.save({
        title: step.title,
        description: step.description,
        dueDate: step.dueDate,
        contactId: step.contactId,
        assignedTo: assigneeId,
        transcriptId: transcript.id,
        sourceStepIndex: step.index,
        done: false,
      }));
    }
    return created;
  },
};

const notesDB = {
  async forContact(contactId) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("contact_notes")
      .select("*, profiles(full_name)")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async add(contactId, content) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("contact_notes")
      .insert({
        contact_id: contactId,
        user_id: session.user.id,
        team_id: team.id,
        content,
      })
      .select()
      .single();
    if (error) throw error;
    await logActivity("note_added", "contact", contactId);
    return data;
  },
};

async function getTeamStats() {
  const sb = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const stats = await Promise.all(
    members.map(async (member) => {
      const [contacts, deals, tasks, activities] = await Promise.all([
        sb.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", member.id),
        sb.from("deals").select("amount, stage").eq("user_id", member.id),
        sb.from("tasks").select("done").eq("user_id", member.id),
        sb.from("activities").select("id", { count: "exact", head: true }).eq("user_id", member.id).gte("created_at", sinceIso),
      ]);

      const dealRows = deals.data || [];
      const openDeals = dealRows.filter((d) => !["Won", "Lost"].includes(d.stage));
      const wonDeals = dealRows.filter((d) => d.stage === "Won");
      const taskRows = tasks.data || [];

      return {
        member,
        contacts: contacts.count || 0,
        openDeals: openDeals.length,
        pipeline: openDeals.reduce((s, d) => s + Number(d.amount || 0), 0),
        won: wonDeals.reduce((s, d) => s + Number(d.amount || 0), 0),
        tasksDone: taskRows.filter((t) => t.done).length,
        tasksTotal: taskRows.length,
        activityScore: activities.count || 0,
      };
    })
  );

  return stats.sort((a, b) => b.activityScore - a.activityScore);
}

function formatCurrency(amount) {
  if (amount == null || amount === "") return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + "T00:00:00") < today;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  return dateStr === new Date().toISOString().slice(0, 10);
}

function canEdit() {
  return getViewingUserId() === session?.user?.id || isAdmin();
}

function importanceScore(level) {
  return { high: 3, medium: 2, low: 1 }[level] || 1;
}

function mapTranscript(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    filename: row.filename,
    content: row.content,
    callSummary: row.call_summary,
    analysis: row.analysis || [],
    status: row.status,
    errorMessage: row.error_message,
    assignedTo: row.assigned_to || null,
    sourceType: row.source_type || "call",
    createdAt: row.created_at,
  };
}

function truncateText(text, max = 120) {
  const cleaned = normalizePunctuation(text);
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.55 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

const INVALID_PERSON_NAMES = new Set([
  "and", "or", "the", "a", "an", "to", "for", "with", "info", "information",
  "contact", "team", "them", "their", "this", "that", "these", "those", "back",
  "follow", "call", "email", "send", "schedule", "discuss", "meeting", "next",
  "lead", "leads", "plan", "free", "paid", "customer", "client", "user", "users",
  "data", "details", "notes", "summary", "update", "week", "today", "tomorrow",
]);

const PDF_WORD_FIXES = [
  [/speci\s+fi\s+c/gi, "specific"],
  [/pro\s+fi\s+le/gi, "profile"],
  [/pro\s+fi\s+les/gi, "profiles"],
  [/fi\s+nd(ing|s)?/gi, "find$1"],
  [/identi\s+fi(ed|es|cation)/gi, "identifi$1"],
  [/modi\s+fi(ed|es|cation)/gi, "modifi$1"],
  [/quali\s+fi(ed|es|cation)/gi, "qualifi$1"],
  [/signi\s+fi\s+cant/gi, "significant"],
  [/e\s*\.\s*g\s*\./gi, "e.g."],
  [/i\s*\.\s*e\s*\./gi, "i.e."],
];

function fixPdfWordBreaks(text) {
  let t = text;
  for (const [pattern, replacement] of PDF_WORD_FIXES) {
    t = t.replace(pattern, replacement);
  }
  for (let pass = 0; pass < 4; pass++) {
    t = t.replace(/\b([a-z]{3,10})\s+([a-z]{1,2})\s+([a-z]{1,3})\b/gi, (m, a, b, c) => {
      if (/^(fi|fl|ff)$/i.test(b)) return a + b + c;
      return m;
    });
    t = t.replace(/\b([a-z]{2,10})\s+([a-z]{1,4})\b/gi, (m, left, right) => {
      if (/^(plan|team|call|lead|leads|tool|demo|free|paid|the|and|for|with|from|was|are|per|our|one|two|vs|day|week|min|hour|pi|b2b|csv|api|url|os|not|but|you|they|this|that|have|has|had|will|can|may|also|very|each|all|any|new|old|use|used|using|about|after|before|during|into|over|under|between|within|without|through|across|around|along|while|where|when|what|which|who|whom|whose|why|how|than|then|them|their|there|these|those|been|being|were|would|could|should|might|must|shall|does|did|done|doing|said|says|make|made|making|take|took|taken|taking|give|gave|given|giving|get|got|getting|see|saw|seen|seeing|know|knew|known|knowing|think|thought|thinking|want|wanted|wanting|need|needed|needing|work|worked|working|help|helped|helping|show|showed|shown|showing|look|looked|looking|find|found|finding|tell|told|telling|ask|asked|asking|try|tried|trying|start|started|starting|run|ran|running|add|added|adding|set|sets|setting|put|puts|putting|keep|kept|keeping|let|lets|letting|seem|seemed|seeming|feel|felt|feeling|leave|left|leaving|turn|turned|turning|bring|brought|bringing|begin|began|begun|beginning|write|wrote|written|writing|provide|provided|providing|include|included|including|become|became|becoming)$/i.test(right)) {
        return m;
      }
      if (/^(ing|tion|ment|ness|able|ible|ally|ful|less|est|ed|ly|es|en|er|ty|al|ic|ive|ous|nd|ng|ce|cy)$/i.test(right)) return left + right;
      if (/^(fi|fl|ff|ti|c)$/i.test(right) && left.length <= 7) return left + right;
      return m;
    });
  }
  return t;
}

function normalizePunctuation(text) {
  let s = (text || "")
    .replace(/[●•◦▪►·○]/g, " ")
    .replace(/[\u2022\u2023\u2043\u2219]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^[\s"'"")\]}>]+/, "");
  s = s.replace(/[\s"'""(\[{<]+$/, "");
  s = s.replace(/^\(\s*["'""]?([^)"']+)["'""]?\s*\)\s*/, "$1 ");
  s = s.replace(/^["'""]([^"'""]+)["'""]\s*\)\s*/, "$1 ");
  s = s.replace(/^Follow up:\s*/i, "");
  s = s.replace(/^\d+[.)]\s*/, "");
  return s.trim();
}

function normalizeTranscriptText(text) {
  let t = fixPdfWordBreaks(text || "");
  t = t
    .replace(/[●•◦▪►·○]/g, "\n")
    .replace(/[\u2022\u2023\u2043\u2219]/g, "\n")
    .replace(/^\s*[-*]\s+/gm, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}

function cleanTranscriptText(text) {
  return normalizeTranscriptText(text);
}

function cleanSentenceForDisplay(sentence) {
  return normalizePunctuation(sentence);
}

function capitalizeSentence(text) {
  const s = cleanSentenceForDisplay(text);
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isValidPersonName(name) {
  const n = cleanSentenceForDisplay(name);
  if (n.length < 2) return false;
  const lower = n.toLowerCase();
  if (INVALID_PERSON_NAMES.has(lower)) return false;
  const words = lower.split(/\s+/).filter(Boolean);
  if (!words.length || words.every((w) => INVALID_PERSON_NAMES.has(w))) return false;
  if (/^(and|or|the|to|for|with|about|regarding|their|our|your|contact)\b/i.test(n)) return false;
  if (words.length === 1 && (words[0].length < 3 || !/^[A-Z]/.test(n))) return false;
  return /^[a-zA-Z][a-zA-Z\s.'-]*$/.test(n);
}

function firstName(name) {
  if (!isValidPersonName(name)) return null;
  return name.trim().split(/\s+/)[0];
}

function summarizeAsTitle(sentence, max = 50) {
  let s = normalizePunctuation(sentence);
  s = s.replace(/^(?:follow up on|follow up with|discuss|review|check on|look into|need to)\s+/i, "");
  s = capitalizeSentence(s);
  return truncateText(s, max);
}

function buildCallSummary(items) {
  if (!items.length) return "Call transcript uploaded. Review next steps below.";
  return items
    .slice(0, 6)
    .map((item) => capitalizeSentence(normalizePunctuation(item)))
    .filter((s) => s.length >= 20 && !/\be\.\s*$/i.test(s) && !/\(\s*$/.test(s))
    .join("\n");
}

function detectImportance(text) {
  const lower = text.toLowerCase();
  const urgencyWords = {
    urgent: "high", asap: "high", immediately: "high", critical: "high", important: "high",
    soon: "medium", "when you can": "low",
  };
  for (const [word, level] of Object.entries(urgencyWords)) {
    if (lower.includes(word)) return level;
  }
  return "medium";
}

function findContactInSentence(sentence, contacts) {
  const lower = sentence.toLowerCase();
  return contacts.find((c) => lower.includes(c.name.toLowerCase())) || null;
}

function buildTranscriptCardData(transcript) {
  const summaryLines = parseCallSummaryLines(transcript.callSummary);
  const seen = new Set();
  const nextSteps = (Array.isArray(transcript.analysis) ? transcript.analysis : [])
    .map((p) => enrichPriority(p))
    .map((p) => ({
      text: p.full_text || capitalizeSentence(normalizePunctuation(p.brief || p.action || "")),
      topic: p.topic || "",
      person: isValidPersonName(p.person_name) ? p.person_name : null,
      importance: p.importance || "medium",
      outreach: p.outreach_draft || "",
      contactId: p.contact_id || null,
    }))
    .filter((s) => s.text.length >= 15)
    .filter((s) => {
      const key = s.text.toLowerCase().slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  let preview = "";
  if (transcript.status === "analyzing") preview = "Analyzing…";
  else if (transcript.status === "error") preview = transcript.errorMessage || "Analysis failed";
  else preview = summaryLines[0] || nextSteps[0]?.text || "Open for summary and next steps";

  return { summaryLines, nextSteps, preview: truncateText(preview, 110) };
}

function transcriptSearchBlob(transcript) {
  const card = buildTranscriptCardData(transcript);
  return [
    transcript.title,
    transcript.filename,
    transcript.callSummary,
    transcript.content,
    transcript.status,
    ...card.summaryLines,
    ...card.nextSteps.map((s) => [s.person, s.text].filter(Boolean).join(" ")),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function parseCallSummaryLines(summary) {
  if (!summary) return [];
  let lines = summary.split(/\n+/).map((l) => normalizePunctuation(l)).filter((l) => l.length >= 10);
  if (lines.length <= 1 && summary.includes("●")) {
    lines = normalizeTranscriptText(summary)
      .split(/\n+/)
      .map((l) => normalizePunctuation(l))
      .filter((l) => l.length >= 10);
  }
  if (lines.length <= 1 && summary.length > 120) {
    lines = summary
      .split(/(?<=[.!?])\s+/)
      .map((l) => normalizePunctuation(l))
      .filter((l) => l.length >= 20)
      .slice(0, 5);
  }
  if (!lines.length && summary.trim()) {
    lines = [normalizePunctuation(summary)];
  }
  return lines;
}

function splitTranscriptIntoItems(transcript) {
  const normalized = cleanTranscriptText(transcript);
  const chunks = normalized
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map(cleanSentenceForDisplay)
    .filter((s) => s.length >= 12);

  const seen = new Set();
  const items = [];
  for (const chunk of chunks) {
    const key = chunk.toLowerCase().slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(chunk);
  }
  return items;
}

function buildTalkAbout(sentence, name) {
  const cleaned = cleanSentenceForDisplay(sentence);
  const aboutMatch = cleaned.match(/(?:about|regarding|re:)\s+(.+)/i);
  if (aboutMatch) return truncateText(capitalizeSentence(aboutMatch[1]), 90);
  const discussMatch = cleaned.match(/discuss(?:ed|ing)?\s+(.+)/i);
  if (discussMatch) return truncateText(capitalizeSentence(discussMatch[1]), 90);
  if (isValidPersonName(name)) {
    return `Follow up with ${name} on open items from the call`;
  }
  return summarizeAsTitle(cleaned, 90);
}

function buildOutreachDraft(name, talkAbout, brief) {
  const first = firstName(name);
  if (!first) return "";

  let topic = talkAbout
    .replace(/^Follow up with .+ on open items from the call$/i, "open items from our call")
    .replace(/^Follow up on points from your call with .+$/i, "our last conversation");
  topic = truncateText(topic, 60);
  if (topic) topic = topic.charAt(0).toLowerCase() + topic.slice(1);

  const hook = truncateText(cleanSentenceForDisplay(brief), 75);
  let body = `Hi ${first},\n\n`;
  if (hook && hook.toLowerCase() !== topic.toLowerCase()) {
    body += `I wanted to follow up on ${topic || "our last conversation"}. ${capitalizeSentence(hook)}.\n\n`;
  } else {
    body += `I wanted to follow up on ${topic || "our last conversation"}.\n\n`;
  }
  body += "Would you have time for a quick call this week?\n\nBest";
  return body;
}

function simplifyAction(brief, action) {
  const raw = cleanSentenceForDisplay(action || brief || "");
  return truncateText(raw, 95);
}

function enrichPriority(p) {
  const context = normalizePunctuation(p.brief || p.action || p.topic || "");
  const rawName = (p.person_name || "").trim();
  const validName = isValidPersonName(rawName);
  const fullText = capitalizeSentence(context);
  const talkAbout = truncateText(buildTalkAbout(context, validName ? rawName : ""), 100);
  const brief = truncateText(fullText, 95);
  const outreachDraft = validName ? buildOutreachDraft(rawName, talkAbout, fullText) : "";
  return {
    ...p,
    person_name: validName ? rawName : "",
    full_text: fullText,
    talk_about: talkAbout,
    brief,
    action: fullText,
    outreach_draft: outreachDraft,
  };
}

function analyzeTranscriptLocally(transcript, contacts) {
  const normalized = normalizeTranscriptText(transcript);
  const items = splitTranscriptIntoItems(normalized);
  const summary = buildCallSummary(items);

  const actionHint = /follow|call|email|send|schedule|discuss|review|check|update|confirm|share|prepare|proposal|contract|pricing|demo|lead|plan|speed|issue|bug|fix|upgrade|trial|limit|prompt|competitor|customer|tool|feature|onboard|next|asked|mentioned|noted|action|todo|need to|should/i;

  let stepCandidates = items.filter(
    (s) => s.length >= 25 && actionHint.test(s) && !/\be\.\s*$/i.test(s) && !/\(\s*$/.test(s)
  );
  if (stepCandidates.length < 2) {
    stepCandidates = items.filter((s) => s.length >= 30 && !/\be\.\s*$/i.test(s));
  }

  const seen = new Set();
  const priorities = [];
  for (const sentence of stepCandidates.slice(0, 10)) {
    const key = sentence.toLowerCase().slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);

    const contact = findContactInSentence(sentence, contacts);
    priorities.push(enrichPriority({
      person_name: contact?.name || "",
      contact_id: contact?.id || null,
      importance: detectImportance(sentence),
      topic: summarizeAsTitle(sentence, 60),
      brief: sentence,
      action: sentence,
      rank: priorities.length + 1,
    }));
  }

  return {
    call_summary: summary || "Call transcript uploaded. Review next steps below.",
    priorities,
  };
}

function splitLinkedInIntoItems(text) {
  const normalized = normalizeTranscriptText(text);
  const blocks = normalized.split(
    /\n(?=[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)*\s*\n(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}[\/\-]))/
  );
  const items = [];
  for (const block of blocks) {
    const lines = block.split(/\n/).map(cleanSentenceForDisplay).filter((l) => l.length > 6);
    const body = lines
      .filter((l) => !/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(l))
      .filter((l) => !/^\d{1,2}[\/\-]\d{1,2}/.test(l))
      .filter((l) => !/^(You|Me)$/i.test(l))
      .join(" ");
    if (body.length >= 15) items.push(body);
  }
  if (items.length >= 2) return items;
  return splitTranscriptIntoItems(normalized);
}

function extractLinkedInContactName(fullText) {
  const match = fullText.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+)\s*\n/m);
  if (match && isValidPersonName(match[1])) return match[1];
  return "";
}

function categorizeLinkedInStep(sentence) {
  if (/meet(ing)?|schedule(d| a)?|calendar|zoom|teams|google meet|video call|call (at|on|tomorrow)|coffee chat|sync up|book (a|time)/i.test(sentence)) {
    return "Meeting scheduled";
  }
  if (/follow(ing)? up|get back|send (you|over|the|me)|let me know|circle back|touch base|reconnect|connect again/i.test(sentence)) {
    return "Follow up needed";
  }
  if (/interested|would love|happy to|proposal|pricing|demo|partnership|opportunity/i.test(sentence)) {
    return "Hot lead — respond";
  }
  return summarizeAsTitle(sentence, 50);
}

function linkedInImportance(sentence) {
  const meetingHint = /meet(ing)?|schedule(d| a)?|calendar|zoom|teams|google meet|video call|call (at|on|tomorrow)|coffee chat|sync up|book (a|time)/i;
  const followupHint = /follow(ing)? up|get back|send (you|over|the|me)|let me know|circle back|touch base|reconnect|connect again/i;
  const highHint = /urgent|asap|proposal|contract|pricing|demo|interview|offer|deadline|decision|budget|purchase|sign|interested in/i;
  if (meetingHint.test(sentence) || highHint.test(sentence)) return "high";
  if (followupHint.test(sentence)) return "medium";
  return detectImportance(sentence);
}

function analyzeLinkedInLocally(text, contacts) {
  const normalized = normalizeTranscriptText(text);
  const items = splitLinkedInIntoItems(normalized);
  const summary = buildCallSummary(items.slice(0, 8));
  const defaultContact = extractLinkedInContactName(normalized);
  const seen = new Set();
  const priorities = [];

  for (const sentence of items) {
    if (sentence.length < 12) continue;
    const importance = linkedInImportance(sentence);
    const isAction = categorizeLinkedInStep(sentence) !== summarizeAsTitle(sentence, 50)
      || importance === "high"
      || /follow|meet|send|schedule|call|demo|pricing|interested|happy to|would love/i.test(sentence);
    if (!isAction && sentence.length < 35) continue;

    const key = sentence.toLowerCase().slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);

    const contact = findContactInSentence(sentence, contacts);
    priorities.push(enrichPriority({
      person_name: contact?.name || defaultContact || "",
      contact_id: contact?.id || null,
      importance,
      topic: categorizeLinkedInStep(sentence),
      brief: sentence,
      action: sentence,
      rank: priorities.length + 1,
    }));
  }

  priorities.sort((a, b) => importanceScore(b.importance) - importanceScore(a.importance));
  priorities.forEach((p, i) => { p.rank = i + 1; });

  return {
    call_summary: summary || "LinkedIn conversation uploaded. Review follow-ups below.",
    priorities: priorities.slice(0, 12),
  };
}

async function analyzeTranscriptText(transcript, contacts, sourceType = "call") {
  const normalized = normalizeTranscriptText(transcript);
  if (sourceType === "linkedin") {
    return analyzeLinkedInLocally(normalized, contacts);
  }
  const sb = getSupabase();
  try {
    const { data, error } = await sb.functions.invoke("analyze-transcript", {
      body: { transcript: normalized, contacts: contacts.map((c) => ({ id: c.id, name: c.name })) },
    });
    if (!error && data?.priorities) {
      data.priorities = data.priorities.map((p) => enrichPriority(p));
      if (!data.call_summary || data.call_summary.length > 400) {
        data.call_summary = buildCallSummary(splitTranscriptIntoItems(normalized));
      }
      return data;
    }
    if (data?.error && !data?.priorities) throw new Error(data.error);
  } catch {
    // fall through to local analysis
  }
  return analyzeTranscriptLocally(normalized, contacts);
}

const transcriptsDB = {
  async all({ userId, sourceType } = {}) {
    const sb = getSupabase();
    const uid = userId || getViewingUserId();
    let query = sb
      .from("call_transcripts")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });
    if (sourceType) query = query.eq("source_type", sourceType);
    const { data, error } = await query;
    if (error) {
      if (sourceType && /source_type/.test(error.message || "")) {
        const fallback = await sb.from("call_transcripts").select("*").eq("user_id", uid).order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return (fallback.data || []).map(mapTranscript).filter((t) => (t.sourceType || "call") === sourceType);
      }
      throw error;
    }
    return (data || []).map(mapTranscript);
  },

  async get(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from("call_transcripts").select("*").eq("id", id).single();
    if (error) throw error;
    return mapTranscript(data);
  },

  async upload({ title, filename, content, assignedTo, sourceType = "call" }) {
    if (!team?.id) throw new Error("Set up your team workspace before uploading (sign in and create/join a team).");
    const sb = getSupabase();
    const uid = getViewingUserId();
    if (uid !== session?.user?.id && !isAdmin()) {
      throw new Error("Switch back to your own workspace to upload (you are viewing another team member).");
    }
    const row = {
      user_id: uid,
      team_id: team.id,
      title,
      filename,
      content,
      assigned_to: assignedTo || uid,
      status: "analyzing",
      source_type: sourceType,
    };
    const { data, error } = await sb.from("call_transcripts").insert(row).select().single();
    if (error) {
      if (/source_type/.test(error.message || "")) {
        delete row.source_type;
        const retry = await sb.from("call_transcripts").insert(row).select().single();
        if (retry.error) throw retry.error;
        return mapTranscript(retry.data);
      }
      throw error;
    }
    return mapTranscript(data);
  },

  async setAssignee(id, assignedTo) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("call_transcripts")
      .update({ assigned_to: assignedTo || null })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return mapTranscript(data);
  },

  async saveAnalysis(id, callSummary, priorities, status = "done", errorMessage = null) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("call_transcripts")
      .update({
        call_summary: callSummary,
        analysis: priorities,
        status,
        error_message: errorMessage,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await logActivity("transcript_analyzed", "call_transcript", id);
    return mapTranscript(data);
  },

  async delete(id) {
    const sb = getSupabase();
    const { error } = await sb.from("call_transcripts").delete().eq("id", id);
    if (error) throw error;
  },

  async process(id) {
    const transcript = await transcriptsDB.get(id);
    const contacts = await contactsDB.all();
    const content = normalizeTranscriptText(transcript.content);
    const sourceType = transcript.sourceType || "call";
    let analyzed;
    try {
      const result = await analyzeTranscriptText(content, contacts, sourceType);
      analyzed = await transcriptsDB.saveAnalysis(id, result.call_summary, result.priorities, "done");
    } catch (e) {
      const fallback = sourceType === "linkedin"
        ? analyzeLinkedInLocally(content, contacts)
        : analyzeTranscriptLocally(content, contacts);
      analyzed = await transcriptsDB.saveAnalysis(
        id,
        fallback.call_summary,
        fallback.priorities,
        fallback.priorities.length || fallback.call_summary ? "done" : "error",
        fallback.priorities.length || fallback.call_summary ? null : "No follow-up steps found"
      );
    }
    if (analyzed.status === "done" && analyzed.assignedTo) {
      try {
        await tasksDB.syncFromTranscript(analyzed, analyzed.assignedTo);
      } catch (err) {
        console.warn("Could not sync transcript tasks:", err);
      }
    }
    return analyzed;
  },

  async importLinkedInThread(thread, assigneeId) {
    const enriched = await enrichLinkedInThread(thread);
    const directoryPerson = enriched.directoryId ? await directoryDB.get(enriched.directoryId) : await directoryDB.matchByName(thread.name);
    const content = formatLinkedInThreadContent({ ...enriched, ...thread }, directoryPerson);
    const title = `${thread.name}${enriched.company ? ` — ${enriched.company}` : ""}`;
    const record = await transcriptsDB.upload({
      title,
      filename: "linkedin-extension",
      content,
      assignedTo: assigneeId || getViewingUserId(),
      sourceType: "linkedin",
    });
    return transcriptsDB.process(record.id);
  },

  async importLinkedInThreads(threads, assigneeId) {
    const results = [];
    for (const thread of threads) {
      results.push(await transcriptsDB.importLinkedInThread(thread, assigneeId));
    }
    return results;
  },
};
