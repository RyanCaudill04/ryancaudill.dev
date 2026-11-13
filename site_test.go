package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
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
	read("favicon.ico")
}

// TestIcons checks the tab icon setup is complete: every icon, manifest and
// manifest icon the pages reference is in the build, the apple-touch-icon
// and manifest links are on both pages, favicon.ico holds 16/32/48 frames,
// and the Content-Security-Policy lets the manifest load.
func TestIcons(t *testing.T) {
	out := t.TempDir()
	if err := build(os.DirFS("."), out, "test"); err != nil {
		t.Fatal(err)
	}
	read := func(name string) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(out, filepath.FromSlash(name)))
		if err != nil {
			t.Fatalf("%s isn't in the build: %v", name, err)
		}
		return data
	}

	link := regexp.MustCompile(`<link rel="(icon|apple-touch-icon|manifest)" href="(/[^"]+)"`)
	for _, page := range []string{"index.html", "404.html"} {
		seen := map[string]bool{}
		for _, m := range link.FindAllStringSubmatch(string(read(page)), -1) {
			seen[m[1]] = true
			read(strings.TrimPrefix(m[2], "/"))
		}
		for _, rel := range []string{"icon", "apple-touch-icon", "manifest"} {
			if !seen[rel] {
				t.Errorf("%s has no <link rel=%q>", page, rel)
			}
		}
		if !strings.Contains(string(read(page)), `<meta name="theme-color"`) {
			t.Errorf("%s has no theme-color meta", page)
		}
	}

	// favicon.ico: 16, 32 and 48px frames.
	ico := read("favicon.ico")
	if len(ico) < 6 || ico[2] != 1 || ico[3] != 0 {
		t.Fatal("favicon.ico isn't an icon file")
	}
	var sizes []int
	for i := 0; i < int(ico[4]); i++ {
		sizes = append(sizes, int(ico[6+16*i]))
	}
	if !slices.Equal(sizes, []int{16, 32, 48}) {
		t.Errorf("favicon.ico has frames %v, want [16 32 48]", sizes)
	}

	// Every icon in the manifest exists and has the size it claims.
	var manifest struct {
		Icons []struct{ Src, Sizes string }
	}
	if err := json.Unmarshal(read("static/site.webmanifest"), &manifest); err != nil {
		t.Fatalf("site.webmanifest: %v", err)
	}
	have := map[string]bool{}
	for _, ic := range manifest.Icons {
		cfg, err := png.DecodeConfig(bytes.NewReader(read(strings.TrimPrefix(ic.Src, "/"))))
		if err != nil {
			t.Fatalf("%s: %v", ic.Src, err)
		}
		if got := fmt.Sprintf("%dx%d", cfg.Width, cfg.Height); got != ic.Sizes {
			t.Errorf("%s is %s, manifest says %s", ic.Src, got, ic.Sizes)
		}
		have[ic.Sizes] = true
	}
	for _, size := range []string{"192x192", "512x512"} {
		if !have[size] {
			t.Errorf("site.webmanifest has no %s icon", size)
		}
	}

	if !strings.Contains(string(read("_headers")), "manifest-src 'self'") {
		t.Error("_headers: the Content-Security-Policy has no manifest-src, so the manifest is blocked")
	}
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
