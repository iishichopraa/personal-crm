const listEl = document.getElementById("thread-list");
const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("sync-selected");
const setupPanel = document.getElementById("setup");
const mainPanel = document.getElementById("main");

let threads = [];
let config = null;

async function loadConfig() {
  const stored = await chrome.storage.local.get(["crmConnection"]);
  config = stored.crmConnection || null;
  if (!config?.accessToken) {
    setupPanel.classList.remove("hidden");
  }
}

function saveConfig(next) {
  config = { ...DEFAULT_CRM, ...next };
  return chrome.storage.local.set({ crmConnection: config });
}

document.getElementById("save-connection").addEventListener("click", async () => {
  try {
    const raw = document.getElementById("connection-json").value.trim();
    const parsed = JSON.parse(raw);
    await saveConfig(parsed);
    setupPanel.classList.add("hidden");
    statusEl.textContent = "Connected. Open LinkedIn Messaging and click Refresh.";
  } catch (e) {
    statusEl.textContent = "Invalid connection JSON — copy again from Team CRM.";
  }
});

document.getElementById("settings-toggle").addEventListener("click", () => {
  setupPanel.classList.toggle("hidden");
  if (config) {
    document.getElementById("connection-json").value = JSON.stringify(config, null, 2);
  }
});

async function getLinkedInTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/messaging*" });
  return tabs[0] || null;
}

document.getElementById("refresh").addEventListener("click", async () => {
  statusEl.textContent = "Scanning LinkedIn inbox…";
  listEl.innerHTML = "";
  syncBtn.classList.add("hidden");

  const tab = await getLinkedInTab();
  if (!tab) {
    statusEl.textContent = "Open linkedin.com/messaging first, then click Refresh.";
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_INBOX" });
    if (!res?.ok) throw new Error(res?.error || "Could not read inbox");
    threads = res.threads || [];
    renderThreads();
    statusEl.textContent = threads.length
      ? `${threads.length} conversation${threads.length === 1 ? "" : "s"} waiting for your reply`
      : "No threads need a response (or LinkedIn layout changed — try opening a thread first).";
  } catch (e) {
    statusEl.textContent = "Refresh failed. Reload the LinkedIn messaging page and try again.";
    console.error(e);
  }
});

function renderThreads() {
  listEl.innerHTML = threads.map((t, i) => `
    <details class="thread">
      <summary>
        <span class="badge ${t.importance}">${t.importance}</span>
        <div style="flex:1;min-width:0">
          <div class="thread-name">${escapeHtml(t.name)}</div>
          <div class="thread-preview">${escapeHtml(t.lastMessage)}</div>
        </div>
      </summary>
      <div class="thread-body">
        ${t.headline ? `<p><strong>Role:</strong> <span class="meta">${escapeHtml(t.headline)}</span></p>` : ""}
        ${t.company ? `<p><strong>Company:</strong> <span class="meta">${escapeHtml(t.company)}</span></p>` : ""}
        ${t.needsMeeting ? `<p><strong>Meeting:</strong> <span class="meta">Mentioned in chat — add to calendar</span></p>` : ""}
        ${t.profileUrl ? `<p><a href="${escapeHtml(t.profileUrl)}" target="_blank" rel="noopener">View LinkedIn profile</a></p>` : ""}
        <label><input type="checkbox" class="thread-pick" data-index="${i}" checked /> Add to CRM calendar</label>
      </div>
    </details>
  `).join("");
  syncBtn.classList.toggle("hidden", !threads.length);
}

function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

async function enrichFromDirectory(thread, cfg) {
  try {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/directory_people?team_id=eq.${cfg.teamId}&name=ilike.${encodeURIComponent(thread.name)}&select=*&limit=1`,
      {
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.accessToken}`,
        },
      }
    );
    const rows = await res.json();
    if (!rows?.length) return thread;
    const p = rows[0];
    const title = (p.notes || "").match(/Title:\s*([^|]+)/)?.[1]?.trim() || thread.headline;
    return {
      ...thread,
      company: thread.company || p.company || "",
      headline: thread.headline || title || "",
      email: p.email || "",
    };
  } catch {
    return thread;
  }
}

function formatThreadContent(thread) {
  const lines = [
    `LinkedIn conversation with ${thread.name}`,
    thread.headline ? `Title: ${thread.headline}` : "",
    thread.company ? `Company: ${thread.company}` : "",
    thread.email ? `Email: ${thread.email}` : "",
    thread.profileUrl ? `Profile: ${thread.profileUrl}` : "",
    thread.needsMeeting ? "Action: Meeting or call mentioned — respond to confirm." : "",
    "",
    "Messages:",
    `${thread.name}: ${thread.lastMessage}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function insertThread(thread, cfg) {
  const enriched = await enrichFromDirectory(thread, cfg);
  const body = {
    user_id: cfg.userId,
    team_id: cfg.teamId,
    title: `${enriched.name}${enriched.company ? ` — ${enriched.company}` : ""}`,
    filename: "linkedin-extension",
    content: formatThreadContent(enriched),
    assigned_to: cfg.userId,
    source_type: "linkedin",
    status: "analyzing",
  };
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/call_transcripts?select=id`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "Insert failed");
  }
  const [row] = await res.json();
  return row.id;
}

document.getElementById("sync-selected").addEventListener("click", async () => {
  if (!config?.accessToken) {
    statusEl.textContent = "Connect Team CRM first (⚙ settings).";
    setupPanel.classList.remove("hidden");
    return;
  }

  const picked = [...document.querySelectorAll(".thread-pick:checked")].map((el) => threads[Number(el.dataset.index)]);
  if (!picked.length) {
    statusEl.textContent = "Select at least one conversation.";
    return;
  }

  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  const ids = [];

  try {
    for (const thread of picked) {
      ids.push(await insertThread(thread, config));
    }
    const q = ids.map((id) => `process_linkedin=${id}`).join("&");
    chrome.tabs.create({ url: `http://localhost:3000/?v=21&${q}` });
    statusEl.textContent = `Synced ${ids.length} conversation(s). Team CRM will analyze and add calendar tasks.`;
  } catch (e) {
    statusEl.textContent = "Sync failed — check connection in ⚙ settings.";
    console.error(e);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = "Add selected to CRM calendar";
  }
});

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CRM_CONNECT") {
    saveConfig(msg.payload).then(() => sendResponse({ ok: true }));
    return true;
  }
});

loadConfig();
