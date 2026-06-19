function renderSetupScreen() {
  hideBoot();
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-screen").classList.add("hidden");
  const setup = document.getElementById("setup-screen");
  setup.classList.remove("hidden");
  setup.innerHTML = `
    <div class="auth-card">
      ${ploidBrandHTML()}
      <h2>Connect to Supabase</h2>
      <p class="auth-sub">This CRM runs in the cloud. Set up a free Supabase project, then add your credentials.</p>
      <ol class="setup-steps">
        <li>Create a project at <a href="https://supabase.com" target="_blank">supabase.com</a></li>
        <li>Run <code>supabase/schema.sql</code> in the SQL Editor</li>
        <li>Copy <code>js/config.example.js</code> → <code>js/config.js</code> and paste your URL + anon key</li>
        <li>Deploy to Netlify/Vercel, or serve locally and reload</li>
      </ol>
    </div>`;
}

function renderAuthScreen(mode = "login") {
  hideBoot();
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("setup-screen").classList.add("hidden");
  const auth = document.getElementById("auth-screen");
  auth.classList.remove("hidden");

  const isSignup = mode === "signup";
  auth.innerHTML = `
    <div class="auth-card">
      ${ploidBrandHTML()}
      <h2>${isSignup ? "Create account" : "Sign in"}</h2>
      <p class="auth-sub">${isSignup ? "Pick your team — you'll land in that workspace automatically" : "Sign in to your workspace"}</p>
      <form id="auth-form" class="auth-form">
        <div class="form-group"><label>Full name</label><input name="fullName" ${isSignup ? "required" : ""} /></div>
        <div class="form-group"><label>Email</label><input name="email" type="email" required /></div>
        <div class="form-group"><label>Password</label><input name="password" type="password" required minlength="6" /></div>
        ${isSignup ? `
          <div class="form-group">
            <label>Your team</label>
            <select name="teamSlug" required>${presetTeamSelectOptions()}</select>
            <p class="task-meta">You'll be added to this team as soon as your account is created.</p>
          </div>
        ` : ""}
        <p id="auth-error" class="auth-error hidden"></p>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem">
          ${isSignup ? "Create account" : "Sign in"}
        </button>
      </form>
      <p class="auth-switch">
        ${isSignup ? "Already have an account?" : "Need an account?"}
        <button type="button" class="link-btn" id="auth-toggle">${isSignup ? "Sign in" : "Sign up"}</button>
      </p>
    </div>`;

  if (isSignup) {
    // team picker only — no create/join toggle
  }

  auth.querySelector("#auth-toggle").addEventListener("click", () => renderAuthScreen(isSignup ? "login" : "signup"));

  auth.querySelector("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = auth.querySelector("#auth-error");
    errEl.classList.add("hidden");
    try {
      if (isSignup) {
        await signUp(fd.get("email"), fd.get("password"), fd.get("fullName"), {
          teamSlug: fd.get("teamSlug"),
        });
      } else {
        await signIn(fd.get("email"), fd.get("password"));
      }
      showApp();
    } catch (err) {
      errEl.textContent = err.message || "Something went wrong";
      errEl.classList.remove("hidden");
    }
  });
}

function renderTeamSetupScreen() {
  hideBoot();
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("setup-screen").classList.add("hidden");
  const auth = document.getElementById("auth-screen");
  auth.classList.remove("hidden");

  auth.innerHTML = `
    <div class="auth-card">
      ${ploidBrandHTML()}
      <h2>Choose your team</h2>
      <p class="auth-sub">Pick a workspace. If you're not sure, start with Ploid Overall.</p>
      <form id="team-setup-form" class="auth-form">
        <div class="form-group">
          <label>Team</label>
          <select name="teamSlug" required>${presetTeamSelectOptions()}</select>
        </div>
        <p id="team-setup-error" class="auth-error hidden"></p>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem">Continue</button>
      </form>
      <p class="auth-switch">
        <button type="button" class="link-btn" id="team-setup-signout">Sign out</button>
      </p>
    </div>`;

  auth.querySelector("#team-setup-signout").addEventListener("click", async () => {
    await signOut();
    renderAuthScreen("login");
  });

  auth.querySelector("#team-setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = auth.querySelector("#team-setup-error");
    errEl.classList.add("hidden");
    try {
      await joinTeamBySlug(fd.get("teamSlug"));
      showApp();
    } catch (err) {
      errEl.textContent = err.message || "Something went wrong";
      errEl.classList.remove("hidden");
    }
  });
}

function showApp() {
  hideBoot();
  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("auth-screen").classList.add("hidden");

  if (typeof hasTeam === "function" && !hasTeam()) {
    renderTeamSetupScreen();
    return;
  }

  document.getElementById("app-shell").classList.remove("hidden");

  const prof = getProfile();
  document.getElementById("user-info").textContent = prof?.full_name || getSession()?.user?.email;
  document.getElementById("team-name-label").textContent = getTeam()?.name || "No team";

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", !isAdmin());
  });

  renderMemberTabs();
  applyNavPermissions();
  navigate("dashboard");
}

function renderMemberTabs() {
  const bar = document.getElementById("member-tabs");
  const teamMembers = getMembers();
  if (!isAdmin() || teamMembers.length <= 1) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  bar.innerHTML = `<span class="member-tabs-label">Viewing:</span>` + teamMembers
    .map(
      (m) =>
        `<button class="member-tab ${m.id === getViewingUserId() ? "active" : ""}" data-user-id="${m.id}">
          ${escapeHtml(m.full_name || m.email)}${m.role === "admin" ? " ★" : ""}
        </button>`
    )
    .join("");

  bar.querySelectorAll(".member-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setViewingUserId(tab.dataset.userId);
      renderMemberTabs();
      render();
    });
  });
}

function hideBoot() {
  document.getElementById("boot-screen")?.classList.add("hidden");
}

function showBootError(message) {
  const boot = document.getElementById("boot-screen");
  if (!boot) return;
  boot.classList.remove("hidden");
  boot.innerHTML = `
    <div class="auth-card">
      <h2>Something went wrong</h2>
      <p class="auth-error">${escapeHtml(message)}</p>
      <p class="auth-sub" style="margin-top:1rem">Make sure you open <strong>http://localhost:3000</strong> — not the file directly.</p>
      <button class="btn btn-primary" style="margin-top:1rem" onclick="location.reload()">Reload</button>
    </div>`;
}

let authReady = false;

async function initAuth() {
  // Never stay stuck on Loading forever
  setTimeout(() => {
    if (!authReady) {
      hideBoot();
      renderAuthScreen("login");
      authReady = true;
    }
  }, 10000);

  try {
    if (typeof window.supabase === "undefined") {
      showBootError("Could not load Supabase. Check your internet connection and reload.");
      return;
    }
    if (!isConfigured()) {
      renderSetupScreen();
      return;
    }

    const sb = getSupabase();

    sb.auth.onAuthStateChange(async (event, newSession) => {
      if (event === "INITIAL_SESSION" || !authReady) return;
      session = newSession;
      try {
        if (newSession) {
          await loadProfile();
          await ensureDefaultTeam();
          showApp();
        } else {
          renderAuthScreen("login");
        }
      } catch (err) {
        showBootError(err.message || String(err));
      }
    });

    const activeSession = await loadSession();
    if (activeSession) {
      try {
        await loadProfile();
        await ensureDefaultTeam();
        showApp();
      } catch (err) {
        await signOut().catch(() => {});
        renderAuthScreen("login");
      }
    } else {
      renderAuthScreen("login");
    }
    authReady = true;
  } catch (err) {
    renderAuthScreen("login");
    authReady = true;
  }
}

document.getElementById("sign-out-btn")?.addEventListener("click", async () => {
  await signOut();
  renderAuthScreen("login");
});

initAuth();
