package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestServer renders the real content and templates, so a broken edit to
// content/site.yaml or web/templates fails `make test` before a deploy.
func TestServer(t *testing.T) {
	srv, err := newServer(embedded, false)
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	page := get("/")
	if page.Code != http.StatusOK {
		t.Fatalf("GET /: %d %s", page.Code, page.Body)
	}
	for _, p := range srv.loaded.content.Projects {
		if !strings.Contains(page.Body.String(), ">"+p.Host+"<") {
			t.Errorf("GET /: no row for project %q (%s)", p.ID, p.Host)
		}
	}

	for path, code := range map[string]int{
		"/healthz":          http.StatusOK,
		"/static/style.css": http.StatusOK,
		"/static/":          http.StatusNotFound, // no folder listings
		"/static/nope.css":  http.StatusNotFound,
		"/nothing-here":     http.StatusNotFound,
	} {
		if got := get(path).Code; got != code {
			t.Errorf("GET %s: %d, want %d", path, got, code)
		}
	}
}
