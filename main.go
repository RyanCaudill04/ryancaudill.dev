// Command portfolio serves ryancaudill.dev from the Raspberry Pi: one page
// rendered from content/site.yaml, plus its CSS and images.
//
// Usage: portfolio [-addr host:port] [-dev]
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"
)

// The content and the web files are built into the binary, so deploying
// is copying one file.
//
//go:embed content web
var embedded embed.FS

// version is set at build time (see the Makefile).
var version = "dev"

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "host:port to listen on")
	dev := flag.Bool("dev", false, "read content/ and web/ from disk on every request, so edits show on refresh")
	flag.Parse()

	var files fs.FS = embedded
	if *dev {
		files = os.DirFS(".")
	}
	srv, err := newServer(files, *dev)
	if err != nil {
		log.Fatalf("portfolio: %v", err)
	}

	log.Printf("portfolio %s on http://%s", version, *addr)
	hs := &http.Server{
		Addr:              *addr,
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Fatal(hs.ListenAndServe())
}
