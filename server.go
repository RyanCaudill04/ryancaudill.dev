package main

import (
	"bytes"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/ryancaudill04/ryancaudill.dev/internal/content"
	"github.com/ryancaudill04/ryancaudill.dev/internal/host"
)

const contentPath = "content/site.yaml"

// server serves the page and its static files.
type server struct {
	files  fs.FS
	dev    bool
	loaded *site // the parsed site; reloaded on every request in dev mode
	mux    *http.ServeMux
}

// site is everything parsed from the content and template files.
type site struct {
	content content.Site
	tmpl    *template.Template
}

func newServer(files fs.FS, dev bool) (*server, error) {
	s := &server{files: files, dev: dev, mux: http.NewServeMux()}
	// Load once even in dev mode, so a broken content file fails at start.
	loaded, err := load(files)
	if err != nil {
		return nil, err
	}
	s.loaded = loaded

	static, err := fs.Sub(files, "web/static")
	if err != nil {
		return nil, err
	}
	s.mux.HandleFunc("GET /{$}", s.index)
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok\n"))
	})
	s.mux.Handle("GET /static/", http.StripPrefix("/static/", s.staticFiles(static)))
	return s, nil
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

// current returns the parsed site, reading the files again in dev mode.
func (s *server) current() (*site, error) {
	if s.dev {
		return load(s.files)
	}
	return s.loaded, nil
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Security-Policy", "default-src 'self'; "+
		"style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "+
		"img-src 'self'; script-src 'self'; connect-src 'self'; "+
		"base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	s.mux.ServeHTTP(w, r)
}

func (s *server) index(w http.ResponseWriter, r *http.Request) {
	st, err := s.current()
	if err != nil {
		s.fail(w, err)
		return
	}
	data := struct {
		Site    content.Site
		Host    host.Info
		Version string
	}{st.content, host.Read(), version}

	// Render into a buffer first, so a template error is a clean 500
	// instead of half a page.
	var buf bytes.Buffer
	if err := st.tmpl.ExecuteTemplate(&buf, "index.html", data); err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	buf.WriteTo(w)
}

// staticFiles serves files from dir without listing folders.
func (s *server) staticFiles(dir fs.FS) http.Handler {
	files := http.FileServerFS(dir)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "" || strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		if s.dev {
			w.Header().Set("Cache-Control", "no-store")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=300")
		}
		files.ServeHTTP(w, r)
	})
}

func (s *server) fail(w http.ResponseWriter, err error) {
	log.Printf("portfolio: %v", err)
	msg := "Something broke on the Pi. Try again in a minute."
	if s.dev {
		msg = err.Error() // show the real error while editing
	}
	http.Error(w, msg, http.StatusInternalServerError)
}
