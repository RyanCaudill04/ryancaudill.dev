# Everyday commands. Run `make` with no target to list them.

PI_HOST ?= mc-pi
DEV_ADDR ?= 127.0.0.1:8090
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)

.DEFAULT_GOAL := help
.PHONY: help dev test build build-pi deploy status logs

help: ## List the commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

dev: ## Run locally; edits to content/ and web/ show on refresh
	go run . -dev -addr $(DEV_ADDR)

test: ## Format check, vet and tests (deploy runs this first)
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed on:"; gofmt -l .; exit 1; }
	go vet ./...
	go test ./...

build: ## Build for this machine into bin/
	go build -ldflags "-X main.version=$(VERSION)" -o bin/portfolio .

build-pi: ## Build for the Pi (linux/arm64) into bin/
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath \
		-ldflags "-s -w -X main.version=$(VERSION)" -o bin/portfolio-linux-arm64 .

deploy: ## Test, build and install on the Pi
	PI_HOST=$(PI_HOST) scripts/deploy.sh

status: ## Show the service on the Pi
	ssh $(PI_HOST) systemctl --user status portfolio --no-pager

logs: ## Follow the service's logs on the Pi
	ssh $(PI_HOST) journalctl --user-unit portfolio -f
