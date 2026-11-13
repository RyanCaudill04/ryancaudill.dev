// The page's behaviour: the header, things that appear as you scroll, the
// footer clock, the terminal prompt, and starting the 3D stage. The page
// reads fine without any of it.

import { startTerminal } from './terminal.js';

const root = document.documentElement;
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, from = document) => from.querySelector(sel);
const $$ = (sel, from = document) => [...from.querySelectorAll(sel)];

// --- The 3D stage -----------------------------------------------------------
// Lay the page out for it straight away, so nothing jumps when it arrives,
// then load the scene (and three.js with it) off the critical path.
let stage = null;
const stageEl = $('[data-stage]');
if (stageEl && window.WebGL2RenderingContext) {
  root.classList.add('has-3d');
  import('./scene.js')
    .then(({ startStage }) => startStage({
      stage: stageEl,
      view: $('[data-view]'),
      canvas: $('[data-canvas]'),
      glow: $('[data-glow]'),
      lines: $('[data-lines]'),
      lead: $('[data-lead]'),
      ring: $('[data-lead-ring]'),
      dot: $('[data-lead-dot]'),
      heroSlot: $('[data-slot="hero"]'),
      intro: $('.intro'),
      teardown: $('[data-teardown]'),
      teardownSlot: $('[data-slot="teardown"]'),
      cards: $$('[data-layers] .layer'),
      steps: $$('[data-steps] button'),
      caption: $('.slot--hero figcaption'),
      hint: $('[data-hint]'),
    }, { drive: stageEl.dataset.drive, still }))
    .then((api) => {
      stage = api;
      root.classList.add('is-live');
    })
    .catch((err) => {
      // No WebGL after all: fall back to the drawing and the plain layout.
      console.warn('3D stage unavailable:', err);
      root.classList.remove('has-3d');
      root.classList.add('no-3d');
    });
} else {
  root.classList.add('no-3d');
}

// --- Header: a backdrop once you've scrolled, a progress line, the current section
const top = $('[data-top]');
const bar = $('[data-progress]');
let ticking = false;
function onScroll() {
  ticking = false;
  const y = window.scrollY;
  top?.classList.toggle('is-scrolled', y > 24);
  if (bar) bar.style.transform = `scaleX(${Math.min(1, y / Math.max(1, root.scrollHeight - window.innerHeight))})`;
  readAlong();
}
window.addEventListener('scroll', () => {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(onScroll);
  }
}, { passive: true });

const links = $$('.top nav a[href^="#"]');
const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
if (sections.length) {
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      // Leaving a section clears its link too, so the hero (or a gap) shows none lit.
      if (!entry.isIntersecting) {
        for (const a of links) if (a.getAttribute('href') === `#${entry.target.id}`) a.removeAttribute('aria-current');
        continue;
      }
      for (const a of links) {
        if (a.getAttribute('href') === `#${entry.target.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => seen.observe(s));
}

// --- The about text brightens word by word as it's scrolled through --------
const lead = $('[data-words]');
let words = [];
if (lead && !still) {
  const text = lead.textContent;
  lead.setAttribute('aria-label', text);
  lead.replaceChildren(...text.split(/(\s+)/).map((piece) => {
    if (!piece.trim()) return piece;
    const span = document.createElement('span');
    span.className = 'w';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = piece;
    return span;
  }));
  words = $$('.w', lead);
}
function readAlong() {
  if (!words.length) return;
  const r = lead.getBoundingClientRect();
  const vh = window.innerHeight;
  // Lit from when the paragraph's top is 85% down the screen to when its
  // bottom is 45% down.
  const done = (vh * 0.85 - r.top) / (r.height + vh * 0.4);
  const upTo = Math.round(Math.min(1, Math.max(0, done)) * words.length);
  words.forEach((w, i) => w.classList.toggle('on', i < upTo));
}

// --- Things that rise into place the first time they're seen ---------------
if (!still && 'IntersectionObserver' in window) {
  root.classList.add('reveal-on');
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  $$('[data-reveal]').forEach((n) => reveal.observe(n));
}

// --- Pause the fallback board's LEDs when it's off-screen or the tab is hidden
const piArt = $('.pi-wrap');
if (piArt && 'IntersectionObserver' in window) {
  let onScreen = true;
  const sync = () => piArt.classList.toggle('is-paused', !onScreen || document.hidden);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(piArt);
  document.addEventListener('visibilitychange', sync);
}

// --- Footer clock ------------------------------------------------------------
const clock = $('[data-clock]');
if (clock) {
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: clock.dataset.clock, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const tick = () => { clock.textContent = format.format(new Date()); };
    tick();
    setInterval(tick, 20_000);
  } catch {
    clock.parentElement.hidden = true; // a time zone this browser doesn't know
  }
}

// --- Terminal ----------------------------------------------------------------
const terminal = $('[data-terminal]');
if (terminal) startTerminal(terminal, { stage: () => stage });

onScroll();
