// Command portfolio builds ryancaudill.dev: one page rendered from
// content/site.yaml, written with its CSS and images into a folder that
// Cloudflare Pages serves as a static site.
//
// Usage:
//
//	portfolio [-out dist] [-version v]   build the site into dist/
//	portfolio -dev [-addr host:port]     preview it locally while editing
package main

import (
	"flag"
	"log"
	"os"
)

func main() {
	out := flag.String("out", "dist", "folder to build the site into")
	ver := flag.String("version", defaultVersion(), "version shown in the footer")
	dev := flag.Bool("dev", false, "serve a local preview instead of building; edits show on refresh")
	addr := flag.String("addr", "127.0.0.1:8090", "host:port for -dev")
	flag.Parse()

	files := os.DirFS(".")
	if *dev {
		log.Printf("portfolio preview on http://%s", *addr)
		log.Fatal(serve(*addr, files))
	}
	if err := build(files, *out, *ver); err != nil {
		log.Fatalf("portfolio: %v", err)
	}
	log.Printf("portfolio %s built into %s/", *ver, *out)
}

// defaultVersion is the short commit on Cloudflare Pages, which sets
// CF_PAGES_COMMIT_SHA for every build, and "dev" anywhere else.
func defaultVersion() string {
	if sha := os.Getenv("CF_PAGES_COMMIT_SHA"); len(sha) >= 7 {
		return sha[:7]
	}
	return "dev"
}
