const VIEW_ACCESS = {
  admin: ["dashboard", "search", "contacts", "companies", "deals", "tasks", "transcripts", "linkedin", "reports", "settings", "team"],
  sales: ["dashboard", "search", "contacts", "companies", "deals", "tasks", "transcripts", "linkedin", "reports"],
  marketing: ["dashboard", "search", "contacts", "companies", "tasks", "reports"],
  support: ["dashboard", "search", "contacts", "companies", "tasks", "transcripts", "linkedin"],
  member: ["dashboard", "search", "contacts", "companies", "deals", "tasks", "transcripts", "linkedin", "reports"],
};

function getUserRole() {
  return getProfile()?.role || "member";
}

function canAccessView(view) {
  return (VIEW_ACCESS[getUserRole()] || VIEW_ACCESS.member).includes(view);
}

function canEditDeals() {
  return ["admin", "sales", "member"].includes(getUserRole()) && canEdit();
}

function applyNavPermissions() {
  document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
    const view = el.dataset.view;
    el.classList.toggle("hidden", !canAccessView(view));
  });
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", getUserRole() !== "admin");
  });
}

function roleLabel(role) {
  return { admin: "Admin", sales: "Sales", marketing: "Marketing", support: "Support", member: "Member" }[role] || role;
}
