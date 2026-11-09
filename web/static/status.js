// Keeps the status lights fresh. The page arrives with real states
// already filled in by the server; this asks /api/status again every
// 15 seconds and updates each row's data-state (which style.css turns
// into a light colour) and its status text.
(() => {
  const every = 15000;

  async function refresh() {
    let body;
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      body = await res.json();
    } catch {
      return; // offline or the Pi is busy: keep what's showing
    }

    for (const row of document.querySelectorAll("[data-service]")) {
      const svc = body.services[row.dataset.service];
      if (!svc) continue;
      row.dataset.state = svc.state;
      const text = row.querySelector("[data-state-text]");
      if (text) text.textContent = svc.text;
    }
    for (const el of document.querySelectorAll("[data-host]")) {
      el.textContent = body.host[el.dataset.host] || "–";
    }
  }

  // Don't poll while the tab is hidden; catch up when it's shown again.
  let timer = setInterval(refresh, every);
  document.addEventListener("visibilitychange", () => {
    clearInterval(timer);
    if (!document.hidden) {
      refresh();
      timer = setInterval(refresh, every);
    }
  });
})();
