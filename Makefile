# Everyday commands. Run `make` with no target to list them.

DEV_ADDR ?= 127.0.0.1:8090
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)

.DEFAULT_GOAL := help
.PHONY: help dev test build

help: ## List the commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

dev: ## Preview locally; edits to content/ and web/ show on refresh
	go run . -dev -addr $(DEV_ADDR)

test: ## Format check, vet, Go tests and status function tests
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed on:"; gofmt -l .; exit 1; }
	go vet ./...
	go test ./...
	node --test tests/*.test.js

build: ## Build the static site into dist/, as Cloudflare Pages does
	go run . -out dist -version $(VERSION)
