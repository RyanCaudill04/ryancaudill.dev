package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestBuild builds the real content and templates, so a broken edit to
// content/site.yaml or web/ fails `make test` before Cloudflare builds it.
func TestBuild(t *testing.T) {
	out := t.TempDir()
	if err := build(os.DirFS("."), out, "test"); err != nil {
		t.Fatal(err)
	}
	read := func(name string) string {
		data, err := os.ReadFile(filepath.Join(out, name))
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}

	st, err := load(os.DirFS("."))
	if err != nil {
		t.Fatal(err)
	}
	index := read("index.html")
	for _, p := range st.content.Projects {
		if !strings.Contains(index, ">"+p.Host+"<") {
			t.Errorf("index.html: no row for project %q (%s)", p.ID, p.Host)
		}
	}
	if !strings.Contains(read("404.html"), "404") {
		t.Error("404.html doesn't say 404")
	}
	if !strings.Contains(read("_headers"), "Content-Security-Policy") {
		t.Error("_headers has no Content-Security-Policy")
	}
	read("static/style.css")
	read("static/favicon.svg")
}

func TestBuildRefusesCurrentFolder(t *testing.T) {
	for _, out := range []string{".", "./", "/"} {
		if err := build(os.DirFS("."), out, "test"); err == nil {
			t.Errorf("build into %q: no error", out)
		}
	}
}
