# ryancaudill.dev

My portfolio. It runs on the Raspberry Pi 5 that also runs every project it lists, and each project's light shows whether that project is up right now.

One Go program does everything: it renders the page from [`content/site.yaml`](content/site.yaml), serves the CSS, JS and images, and answers `GET /api/status` with the live state of each project. The content and web files are built into the binary, so a deploy copies a single file to the Pi.

## Edit the content

Everything the page says is in **[`content/site.yaml`](content/site.yaml)**: your name and intro, the projects, past projects and the resume. Add a project there, and a row with its own status light appears.

To make a project's light live, give it a `health:` URL that the Pi can reach (usually `http://127.0.0.1:<port>/...`). Leave it out and the light stays grey ("not monitored").

## Run it locally

```bash
make dev
```

Then open <http://127.0.0.1:8090>. In dev mode the content and templates are reread on every request, so saving a file and refreshing shows the change. Locally, the Pi's services aren't running, so their lights show **failed**. That's expected.

```bash
make test
```

`make test` checks formatting, runs `go vet`, and runs the tests. It also renders the real page, so a typo in `site.yaml` or a template fails here instead of on the Pi.

## Deploy to the Pi

```bash
make deploy
```

This runs the tests, builds a `linux/arm64` binary, copies it to `~/apps/portfolio/releases/<version>/` on the Pi (SSH host `mc-pi`, or set `PI_HOST`), points `~/apps/portfolio/current` at it, and restarts the `portfolio` user service on `127.0.0.1:8080`. Cloudflare Tunnel already routes `ryancaudill.dev` to that port.

```bash
make status
```

```bash
make logs
```

**Rollback:** on the Pi, point `~/apps/portfolio/current` at an earlier folder in `releases/`, then run `systemctl --user restart portfolio`.

### One-time handover from the placeholder site

Until now, the placeholder page was `site@portfolio.service`, deployed from the minecraft-server repo, and it also uses port 8080. `make deploy` stops with instructions while that service is still running. To hand the port over:

1. In minecraft-server, remove `site@portfolio.service` from `deploy/release.json` (and its health URL), so mc-agent stops reinstalling it.
2. Run `ssh mc-pi 'systemctl --user disable --now site@portfolio.service'`.
3. Run `make deploy`.

## How the live status works

```
browser ── GET /api/status ──► portfolio (on the Pi, 127.0.0.1:8080)
                                 ├─► 127.0.0.1:8082/api/status  play     → {"state": "sleeping"}
                                 ├─► 127.0.0.1:8081/healthz     admin    → 200 ok
                                 └─► …one check per project with a health URL
```

- The checks run **on the Pi**, against each service's local port. That's why admin can be checked even though it's behind Cloudflare Access, and why the browser never makes a cross-origin request.
- The results are cached for 10 seconds, so a burst of visitors doesn't turn into a burst of checks. Each check gets 2 seconds before it counts as down.
- The page arrives with the current states already filled in. [`web/static/status.js`](web/static/status.js) refreshes them every 15 seconds while the tab is visible.
- The states are **up** (green), **sleeping** or **starting** (amber), **down** (red) and **not monitored** (grey). Play reports its own state in a JSON field (`state_field: state`). For everything else, any 2xx answer counts as up.
- The footer shows the Pi's uptime, load and CPU temperature, read from `/proc` and `/sys`. On a Mac they show "–".

## Layout

```
main.go, server.go       the program: flags, routes, page rendering
internal/content/        loads and checks content/site.yaml
internal/status/         health checks and caching for the lights (+ tests)
internal/host/           uptime, load and temperature of the Pi
content/site.yaml        all the page's text
web/templates/           index.html (the page), pi.html (the Pi illustration, SVG)
web/static/              style.css, status.js, favicon, resume.pdf
deploy/portfolio.service systemd user unit installed on the Pi
scripts/deploy.sh        what `make deploy` runs
```
