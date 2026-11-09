# ryancaudill.dev

My portfolio. It runs on the Raspberry Pi 5 that also runs every project it lists.

One Go program does everything: it renders the page from [`content/site.yaml`](content/site.yaml) and serves the CSS and images. The content and web files are built into the binary, so a deploy copies a single file to the Pi.

## Edit the content

Everything the page says is in **[`content/site.yaml`](content/site.yaml)**: your name and intro, the projects, past projects and the resume. Add a project there, and a row with its own light appears. For now every active project's light is always on.

## Run it locally

```bash
make dev
```

Then open <http://127.0.0.1:8090>. In dev mode the content and templates are reread on every request, so saving a file and refreshing shows the change. The footer's uptime, load and temperature come from the Pi's `/proc` and `/sys`, so on a Mac they show "–".

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

## Layout

```
main.go, server.go       the program: flags, routes, page rendering (+ test)
internal/content/        loads and checks content/site.yaml
internal/host/           uptime, load and temperature of the Pi
content/site.yaml        all the page's text
web/templates/           index.html (the page), pi.html (the Pi illustration, SVG)
web/static/              style.css, favicon, resume.pdf
deploy/portfolio.service systemd user unit installed on the Pi
scripts/deploy.sh        what `make deploy` runs
```
