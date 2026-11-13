// Keeps the status lights live. Rows start grey ("checking…"); this asks
// /api/status and sets each row's data-state (style.css turns it into a
// light colour) and its status text, then asks again every 15 seconds
// while the tab is visible.

const EVERY = 15000;

/** Fetches /api/status and updates the rows. */
async function refresh(root) {
  let body;
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) return;
    body = await res.json();
  } catch {
    return; // offline, or the preview has no function: keep what's showing
  }
  for (const row of root.querySelectorAll('[data-unit]')) {
    const svc = body.services?.[row.dataset.unit];
    if (!svc) continue;
    row.dataset.state = svc.state;
    const label = row.querySelector('[data-state-text]');
    if (label) label.textContent = svc.text;
  }
}

export function startStatus(root) {
  let timer = 0;
  const poll = () => {
    window.clearInterval(timer);
    refresh(root);
    timer = window.setInterval(() => refresh(root), EVERY);
  };
  poll();
  // Don't poll a hidden tab; catch up as soon as it's shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearInterval(timer);
    else poll();
  });
}
