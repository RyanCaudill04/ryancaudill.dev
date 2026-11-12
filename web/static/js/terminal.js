// The terminal's prompt. The page already prints two commands and their
// output; this makes the last line a prompt that takes a few more.
//
// Everything it prints comes from the page itself (the project rows, the
// about text, the resume), so content/site.yaml stays the only place the
// content lives.

const HELP = [
  ['help', 'this list'],
  ['ls [--archive]', 'the projects, or the past ones'],
  ['systemctl status <unit>', 'one project in detail'],
  ['open <unit>', 'go to a project'],
  ['whoami', 'the short version'],
  ['cat about | resume', 'the longer version'],
  ['neofetch', 'the machine'],
  ['explode | assemble | spin', 'play with the 3D model'],
  ['clear', 'tidy up'],
];

const BERRY = [
  '   .~~.   .~~.   ',
  "  '. \\ ' ' / .'  ",
  '   .~ .~~~..~.   ',
  "  : .~.'~'.~. :  ",
  ' ~ (   ) (   ) ~ ',
  "( : '~'.~.'~' : )",
  ' ~ .~ (   ) ~. ~ ',
  "  (  : '~' :  )  ",
  "   '~ .~~~. ~'   ",
  "       '~'       ",
];

/** el('span', 'dim', 'text') or el('a', {href}, 'text'): a small DOM helper. */
function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (typeof attrs === 'string') node.className = attrs;
  else for (const k in attrs) node.setAttribute(k, attrs[k]);
  node.append(...kids);
  return node;
}

export function startTerminal(root, { stage } = {}) {
  const input = root.querySelector('[data-term-input]');
  const log = root.querySelector('[data-term-log]');
  const ghost = root.querySelector('[data-term-ghost]');
  if (!input || !log) return;

  // What the page says, read back out of it.
  const text = (node, sel) => node.querySelector(sel)?.textContent.trim() || '';
  const row = (node, id) => ({ id, host: text(node, '.unit__host'), desc: text(node, '.unit__desc'), url: node.getAttribute('href') || '' });
  const units = [...root.querySelectorAll('[data-unit]')].map((n) => row(n, n.dataset.unit));
  const past = [...root.querySelectorAll('[data-past]')].map((n) => row(n, n.dataset.past));
  const page = {
    name: [...document.querySelectorAll('.hero__name span')].map((s) => s.textContent.trim()).join(' '),
    role: document.querySelector('.hero__role')?.textContent.trim() || '',
    about: [...document.querySelectorAll('.about .lead-text, .about .body-text')].map((p) => p.textContent.trim()),
    board: document.querySelector('.slot figcaption span')?.textContent.split(' · ').slice(2).join(' · ') || '',
    layers: [...document.querySelectorAll('.layer h3')].map((h) => h.textContent.trim()),
    jobs: [...document.querySelectorAll('.entries--now li')].map((li) => ({ when: text(li, '.when'), title: text(li, 'b'), org: text(li, '.org') })),
    pdf: document.querySelector('.resume .btn')?.getAttribute('href') || '',
  };
  const find = (id) => units.find((u) => u.id === id) || past.find((u) => u.id === id);

  const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));
  const link = (url, label = url) => el('a', { href: url }, label);

  // Each command returns what to print: strings and nodes, one per line
  // unless a line is itself a list of pieces.
  const commands = {
    help: () => HELP.map(([c, what]) => [el('span', 'hi', pad(c, 28)), el('span', 'dim', what)]),
    ls: (arg = '') => {
      const list = arg === '--archive' ? past : arg && !/^(~|\.|projects)\/?$/.test(arg) ? null : units;
      if (!list) return [el('span', 'err', `ls: cannot access '${arg}': No such file or directory`)];
      // One grid, so a long description wraps under itself, not under the name.
      return [[el('div', 'term__ls', ...list.flatMap((u) => [u.url ? link(u.url, u.id) : el('span', {}, u.id), el('span', 'dim', u.desc)]))]];
    },
    systemctl: (verb, id) => {
      if (verb === 'list-units') return units.map((u) => [el('span', 'ok', '● '), pad(u.id, 16), el('span', 'dim', 'active (running)')]);
      if (verb !== 'status' || !id) return [el('span', 'dim', 'usage: systemctl status <unit>   (units: ' + units.map((u) => u.id).join(', ') + ')')];
      const u = find(id.replace(/\.service$/, ''));
      if (!u) return [el('span', 'err', `Unit ${id}.service could not be found.`)];
      const live = units.includes(u);
      return [
        [el('span', live ? 'ok' : 'dim', live ? '● ' : '○ '), el('span', 'hi', `${u.id}.service`), ` - ${u.desc}`],
        [el('span', 'dim', '     Loaded: '), `loaded (${live ? 'enabled' : 'disabled'})`],
        [el('span', 'dim', '     Active: '), el('span', live ? 'ok' : 'dim', live ? 'active (running)' : 'inactive (dead)')],
        ...(u.host ? [[el('span', 'dim', '       Host: '), u.url ? link(u.url, u.host) : u.host]] : []),
        ...(!u.host && u.url ? [[el('span', 'dim', '     Source: '), link(u.url)]] : []),
      ];
    },
    open: (id) => {
      const u = id && find(id);
      if (!u) return [el('span', 'err', id ? `open: ${id}: no such unit` : 'usage: open <unit>')];
      if (!u.url) return [`${u.id} isn't a web page${u.host ? `; it listens at ${u.host}` : ''}.`];
      window.setTimeout(() => window.location.assign(u.url), 350);
      return [['Opening ', link(u.url), ' …']];
    },
    whoami: () => [el('span', 'hi', page.name), page.role],
    cat: (file = '') => {
      const name = file.replace(/^~\//, '').replace(/\.(txt|md)$/, '');
      if (name === 'about') return page.about.flatMap((p, i) => (i ? ['', p] : [p]));
      if (name === 'resume') {
        document.getElementById('resume')?.scrollIntoView();
        return [...page.jobs.map((j) => [el('span', 'dim', pad(j.when, 22)), el('span', 'hi', j.title), j.org ? ` · ${j.org}` : '']), ...(page.pdf ? ['', ['The full thing: ', link(page.pdf)]] : [])];
      }
      return [el('span', 'err', file ? `cat: ${file}: No such file or directory` : 'usage: cat about | resume')];
    },
    neofetch: () => {
      const facts = [
        [el('span', 'ok', 'ryan'), '@', el('span', 'ok', 'pi')],
        [el('span', 'dim', '-------')],
        [el('span', 'hi', 'Host     '), page.board || 'Raspberry Pi 5'],
        ...(page.layers.length ? [[el('span', 'hi', 'Stack    '), page.layers.join(' / ')]] : []),
        [el('span', 'hi', 'Units    '), `${units.length} running, ${past.length} archived`],
        [el('span', 'hi', 'Shell    '), 'this page'],
      ];
      return BERRY.map((art, i) => [el('span', i < 2 ? 'ok' : 'berry', art), '  ', ...(facts[i] || [])]);
    },
    explode: () => (stage() ? (stage().explode(true), ['Taking it apart. Scroll to go layer by layer.']) : ['No 3D here: this browser kept it switched off.']),
    assemble: () => (stage() ? (stage().explode(false), ['Back together.']) : ['Nothing to put back together.']),
    spin: () => (stage() ? (stage().explode(false), stage().spin(), ['Wheee.']) : ['Nothing to spin.']),
    clear: () => (log.replaceChildren(), []),
    pwd: () => ['/home/ryan'],
    date: () => [new Date().toString()],
    echo: (...words) => [words.join(' ')],
    uname: () => ['Linux'],
    history: () => typed.map((c, i) => `${String(i + 1).padStart(4)}  ${c}`),
    sudo: () => [el('span', 'err', 'visitor is not in the sudoers file. This incident will be reported.')],
    rm: () => [el('span', 'err', "rm: it's a read-only file system (and a nice try)")],
    exit: () => ["There's no leaving. Try help."],
    vim: () => ["You'd never get back out."],
  };
  commands.ll = commands.ls;
  commands.man = commands.help;
  commands.nvim = commands.vi = commands.emacs = commands.nano = commands.vim;

  const typed = []; // the commands entered, oldest first
  let at = 0; // where the up and down keys are in it

  function print(line, lines) {
    log.append(el('p', 'cmd', el('span', {}, '$'), ` ${line}`));
    if (!lines.length) return;
    const out = el('pre', 'term__out');
    [].concat(lines).forEach((l, i) => out.append(...(i ? ['\n'] : []), ...[].concat(l)));
    log.append(out);
  }

  function run(line) {
    line = line.trim();
    if (!line) return;
    typed.push(line);
    at = typed.length;
    const [name, ...args] = line.split(/\s+/);
    const command = Object.hasOwn(commands, name) ? commands[name] : null;
    const lines = command ? command(...args) : [el('span', 'err', `bash: ${name}: command not found`), el('span', 'dim', 'Try help.')];
    if (name !== 'clear') print(line, lines);
    input.scrollIntoView({ block: 'nearest' });
  }

  /** What Tab would complete the line to, or '' if nothing or too much. */
  function complete(line) {
    if (!line || /\s$/.test(line)) return '';
    const words = line.split(/\s+/);
    const last = words[words.length - 1];
    let pool = Object.keys(commands);
    if (words.length > 1) {
      pool = { systemctl: words.length === 2 ? ['status', 'list-units'] : units.map((u) => u.id), open: [...units, ...past].filter((u) => u.url).map((u) => u.id), cat: ['about', 'resume'], ls: ['--archive'] }[words[0]] || [];
    }
    const hits = pool.filter((p) => p.startsWith(last) && p !== last);
    return hits.length === 1 ? hits[0].slice(last.length) : '';
  }

  const hint = () => {
    const rest = complete(input.value);
    ghost.replaceChildren(el('i', {}, input.value), rest);
  };

  input.addEventListener('input', hint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      run(input.value);
      input.value = '';
    } else if (e.key === 'Tab' && complete(input.value)) {
      e.preventDefault();
      input.value += complete(input.value);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      at = Math.min(typed.length, Math.max(0, at + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = typed[at] || '';
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      log.replaceChildren();
    } else {
      return;
    }
    hint();
  });

  // Clicking anywhere on the terminal's blank space puts you at the prompt.
  root.addEventListener('click', (e) => {
    if (!e.target.closest('a, button, input') && !String(window.getSelection())) input.focus({ preventScroll: true });
  });
  for (const b of root.querySelectorAll('[data-run]')) b.addEventListener('click', () => run(b.dataset.run));
}
