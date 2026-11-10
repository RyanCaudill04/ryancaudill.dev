# ryancaudill.dev

My portfolio: a static site on Cloudflare Pages. The projects it lists run on my Raspberry Pi 5.

A small Go program builds it: it renders the page from [`content/site.yaml`](content/site.yaml) and writes it, with the CSS, scripts and images, into `dist/`. Cloudflare Pages runs that build on every push to `main` and serves `dist/`.

The page opens on a 3D model of that Pi: the board, the GeeekPi P33 M.2 NVMe PoE+ HAT on top of it, and the Silicon Power SSD in the HAT's slot. Drag it to turn it, click it to open it up, and scroll through the hardware section to take it apart layer by layer.

## Edit the content

Everything the page says is in **[`content/site.yaml`](content/site.yaml)**: your name and intro, the hardware cards, the projects, past projects and the resume. Add a project there, and a row with its own light appears. For now every active project's light is always on.

## The 3D model

Nothing is loaded from a model file. [`web/static/js/model.js`](web/static/js/model.js) builds every part from boxes and extrusions, in millimetres, and [`textures.js`](web/static/js/textures.js) paints the boards' traces and silkscreen on canvases when the page loads. To change what the hardware looks like, edit those two files:

| To change | Edit |
| --- | --- |
| The SSD's length (30, 42, 60 or 80 mm) | `drive` in `content/site.yaml` |
| A part's size or place, or add one | `model.js`: each part is one line, e.g. `part(pi, x, z, width, depth, height, material)` |
| Silkscreen text, the SSD's label, chip markings | `textures.js` |
| The angle and zoom at each point of the page | `VIEWS` at the top of [`scene.js`](web/static/js/scene.js) |
| How far the layers move apart | `pose()` in `model.js` |

The cards in the hardware section each name the part they point at (`ssd`, `hat` or `pi`); the model draws its annotation line to that part.

Where the model can't run (no JavaScript, or no WebGL) the page shows the drawing in [`web/templates/pi.html`](web/templates/pi.html) instead, and the hardware cards become a plain row. Visitors who ask their system for reduced motion get the model without the drifting and the entrance.

## Run it locally

```bash
make dev
```

Then open <http://127.0.0.1:8090>. The content and templates are reread on every request, so saving a file and refreshing shows the change. The preview sends the same Content-Security-Policy as the real site, so anything the policy would block is blocked here too.

```bash
make test
```

`make test` checks formatting, runs `go vet`, and runs the tests. The tests build the real site, so a typo in `site.yaml` or a template fails here instead of on Cloudflare. They also check that every file the pages and scripts load is in the build.

```bash
make build
```

`make build` writes the site into `dist/` exactly as Cloudflare does: `index.html`, `404.html`, `_headers`, `robots.txt` and `static/`.

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

Response headers (the Content-Security-Policy and friends) are in [`web/_headers`](web/_headers). Pages applies them to every response. The policy allows scripts, styles and fonts from the site itself and nowhere else, which is why the fonts and three.js are in `web/static/` rather than loaded from a CDN.

## Bundled files

These are other people's work, kept in the repo so the page loads nothing from another site:

| File | What | Licence |
| --- | --- | --- |
| `web/static/vendor/three.module.min.js` | [three.js](https://threejs.org) 0.187.0, minified into one file | MIT (`LICENSE-three.txt` beside it) |
| `web/static/fonts/*.woff2` | Instrument Serif, Inter and JetBrains Mono, Latin subset, from [Fontsource](https://fontsource.org) | SIL Open Font License (the `OFL-*.txt` files beside them) |

To move to a newer three.js:

```bash
npm install three esbuild
npx esbuild node_modules/three/build/three.module.js --bundle --minify --format=esm \
  --legal-comments=inline --outfile=web/static/vendor/three.module.min.js
```

`web/static/og.jpg`, the picture link previews show, is a 1200 × 630 screenshot of the top of the page. Retake it if the hero changes.

## Layout

```
main.go             flags: build into dist/, or -dev for a local preview
site.go             loads the content and templates, builds dist/, dev server (+ test)
internal/content/   loads and checks content/site.yaml (+ test)
content/site.yaml   all the page's text
web/templates/      index.html (the page), 404.html, partials.html (shared pieces),
                    pi.html (the Pi drawing, shown when the 3D model can't run)
web/static/         style.css, favicon, resume.pdf, og.jpg
web/static/js/      main.js      the page: header, scroll effects, starts the rest
                    scene.js     the 3D stage: camera, lighting, scroll and drag
                    model.js     the Pi, HAT and SSD, part by part
                    textures.js  the boards' traces, silkscreen and labels
                    terminal.js  the prompt in the projects terminal
                    boot.js      marks the page as scripted before it paints
web/static/fonts/   the three typefaces, and their licences
web/static/vendor/  three.js
web/_headers        response headers for Cloudflare Pages
web/robots.txt      crawler rules, served at /robots.txt
```
