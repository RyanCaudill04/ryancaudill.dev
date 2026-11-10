package main

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
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
	for _, l := range st.content.Hardware {
		if !strings.Contains(index, `data-part="`+l.Part+`"`) {
			t.Errorf("index.html: no hardware card for %q", l.Part)
		}
	}
	if !strings.Contains(read("404.html"), "404") {
		t.Error("404.html doesn't say 404")
	}
	if !strings.Contains(read("_headers"), "Content-Security-Policy") {
		t.Error("_headers has no Content-Security-Policy")
	}
	if !strings.Contains(read("robots.txt"), "User-agent:") {
		t.Error("robots.txt has no User-agent line")
	}
	read("static/style.css")
	read("static/favicon.svg")
}

// TestBuildLinks checks that everything the pages load is in the build:
// each /static/ address in the HTML and CSS, and each file a script
// imports. The Content-Security-Policy only allows files from the site
// itself, so a mistyped path is a font or a script that never arrives.
func TestBuildLinks(t *testing.T) {
	out := t.TempDir()
	if err := build(os.DirFS("."), out, "test"); err != nil {
		t.Fatal(err)
	}
	exists := func(from, name string) {
		t.Helper()
		if _, err := os.Stat(filepath.Join(out, filepath.FromSlash(name))); err != nil {
			t.Errorf("%s loads %s, which isn't in the build", from, name)
		}
	}

	static := regexp.MustCompile(`/static/[A-Za-z0-9_./-]+`)
	for _, page := range []string{"index.html", "404.html", "static/style.css"} {
		data, err := os.ReadFile(filepath.Join(out, page))
		if err != nil {
			t.Fatal(err)
		}
		for _, link := range static.FindAllString(string(data), -1) {
			exists(page, strings.TrimPrefix(link, "/"))
		}
		if strings.Contains(string(data), "https://fonts.") {
			t.Errorf("%s loads fonts from another site; the Content-Security-Policy blocks that", page)
		}
	}

	imports := regexp.MustCompile(`(?:from|import\()\s*'(\.\.?/[^']+)'`)
	scripts, err := filepath.Glob(filepath.Join(out, "static", "js", "*.js"))
	if err != nil || len(scripts) == 0 {
		t.Fatalf("no scripts in the build (%v)", err)
	}
	for _, script := range scripts {
		data, err := os.ReadFile(script)
		if err != nil {
			t.Fatal(err)
		}
		name := "static/js/" + filepath.Base(script)
		for _, m := range imports.FindAllStringSubmatch(string(data), -1) {
			exists(name, path.Join(path.Dir(name), m[1]))
		}
	}
}

// TestSiteHeaders checks the preview sends the headers Cloudflare will:
// the "/*" block of web/_headers, and nothing from the other blocks.
func TestSiteHeaders(t *testing.T) {
	headers, err := siteHeaders(os.DirFS("."))
	if err != nil {
		t.Fatal(err)
	}
	csp := headers.Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'none'", "script-src 'self'", "font-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("Content-Security-Policy %q has no %q", csp, want)
		}
	}
	if got := headers.Get("Cache-Control"); got != "" {
		t.Errorf("Cache-Control %q belongs to /static/* only", got)
	}
}

func TestBuildRefusesCurrentFolder(t *testing.T) {
	for _, out := range []string{".", "./", "/"} {
		if err := build(os.DirFS("."), out, "test"); err == nil {
			t.Errorf("build into %q: no error", out)
		}
	}
}
