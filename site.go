package main

import (
	"bytes"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ryancaudill04/ryancaudill.dev/internal/content"
)

const contentPath = "content/site.yaml"

// The pages rendered from web/templates, each written to the same name in
// the output folder. Cloudflare Pages serves 404.html for any path it has
// no file for; without it, Pages would answer every path with index.html.
var pages = []string{"index.html", "404.html"}

// Files in web/ copied as-is to the root of the output folder: response
// headers for Cloudflare Pages, and the crawler rules at /robots.txt.
var rootFiles = []string{"_headers", "robots.txt"}

// site is everything parsed from the content and template files.
type site struct {
	content content.Site
	tmpl    *template.Template
}

func load(files fs.FS) (*site, error) {
	c, err := content.Load(files, contentPath)
	if err != nil {
		return nil, err
	}
	tmpl, err := template.ParseFS(files, "web/templates/*.html")
	if err != nil {
		return nil, err
	}
	return &site{content: c, tmpl: tmpl}, nil
}

// render executes one page template into a buffer, so a template error
// never leaves half a page behind.
func (s *site) render(name, version string) ([]byte, error) {
	data := struct {
		Site    content.Site
		Version string
	}{s.content, version}
	var buf bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&buf, name, data); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// build writes the whole site into out, replacing what was there:
//
//	index.html, 404.html   the rendered pages
//	_headers, robots.txt   copied from web/
//	static/                everything in web/static
func build(files fs.FS, out, version string) error {
	if clean := filepath.Clean(out); clean == "." || clean == "/" {
		return fmt.Errorf("refusing to build into %q: it gets emptied first", out)
	}
	st, err := load(files)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(out); err != nil {
		return err
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	for _, name := range pages {
		html, err := st.render(name, version)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(out, name), html, 0o644); err != nil {
			return err
		}
	}
	for _, name := range rootFiles {
		data, err := fs.ReadFile(files, "web/"+name)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(out, name), data, 0o644); err != nil {
			return err
		}
	}
	static, err := fs.Sub(files, "web/static")
	if err != nil {
		return err
	}
	return os.CopyFS(filepath.Join(out, "static"), static)
}

// serve is the local preview for `make dev`. It rereads content/ and web/
// on every request, so saving a file and refreshing shows the change.
// Cloudflare serves the real site from the built folder.
func serve(addr string, files fs.FS) error {
	// Load once up front, so a broken content file fails at start.
	if _, err := load(files); err != nil {
		return err
	}
	page := func(name string, code int) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			html, err := func() ([]byte, error) {
				st, err := load(files)
				if err != nil {
					return nil, err
				}
				return st.render(name, "dev")
			}()
			if err != nil {
				log.Printf("portfolio: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(code)
			w.Write(html)
		}
	}
	static, err := fs.Sub(files, "web/static")
	if err != nil {
		return err
	}
	staticFiles := http.StripPrefix("/static/", http.FileServerFS(static))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", page("index.html", http.StatusOK))
	mux.HandleFunc("GET /static/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		staticFiles.ServeHTTP(w, r)
	})
	mux.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFileFS(w, r, files, "web/robots.txt")
	})
	mux.HandleFunc("/", page("404.html", http.StatusNotFound))

	hs := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	return hs.ListenAndServe()
}
