# ryancaudill.dev

My portfolio: a static site on Cloudflare Pages. The projects it lists run on my Raspberry Pi 5.

A small Go program builds it: it renders the page from [`content/site.yaml`](content/site.yaml) and writes it, with the CSS and images, into `dist/`. Cloudflare Pages runs that build on every push to `main` and serves `dist/`.

## Edit the content

Everything the page says is in **[`content/site.yaml`](content/site.yaml)**: your name and intro, the projects, past projects and the resume. Add a project there, and a row with its own light appears. For now every active project's light is always on.

## Run it locally

```bash
make dev
```

Then open <http://127.0.0.1:8090>. The content and templates are reread on every request, so saving a file and refreshing shows the change.

```bash
make test
```

`make test` checks formatting, runs `go vet`, and runs the tests. The tests build the real site, so a typo in `site.yaml` or a template fails here instead of on Cloudflare.

```bash
make build
```

`make build` writes the site into `dist/` exactly as Cloudflare does: `index.html`, `404.html`, `_headers` and `static/`.

## Deploy

Push to `main`. Cloudflare Pages builds and publishes it in about a minute. Pushes to other branches and pull requests get their own preview URL on `*.pages.dev`.

The Pages project's build settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `go run . -out dist` |
| Build output directory | `dist` |
| Environment variable | `GO_VERSION` = `1.27.3` (match `go.mod`) |

The footer shows the commit it was built from (Pages sets `CF_PAGES_COMMIT_SHA`).

**Rollback:** in the Cloudflare dashboard, open the Pages project, go to **Deployments**, and choose **Rollback** on an earlier one.

Response headers (the Content-Security-Policy and friends) are in [`web/_headers`](web/_headers). Pages applies them to every response.

## Layout

```
main.go             flags: build into dist/, or -dev for a local preview
site.go             loads the content and templates, builds dist/, dev server (+ test)
internal/content/   loads and checks content/site.yaml
content/site.yaml   all the page's text
web/templates/      index.html (the page), 404.html, pi.html (the Pi illustration, SVG)
web/static/         style.css, favicon, resume.pdf
web/_headers        response headers for Cloudflare Pages
```
