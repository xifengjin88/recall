# Recall monorepo commands. See SPEC-platform.md.
SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup db db-reset migrate import-content dev-server dev-web test test-server test-web lint security

help: ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-12s %s\n", $$1, $$2}'

setup: ## Install server and web dependencies, start Postgres
	test -f .env || cp .env.example .env
	cd server && uv sync
	cd web && npm ci
	$(MAKE) db migrate import-content

db: ## Start Postgres and wait until it is healthy
	docker compose up -d --wait db

db-reset: ## Wipe the database volume and start fresh
	docker compose down -v
	docker compose up -d --wait db

migrate: ## Apply database migrations
	cd server && uv run --env-file ../.env recall db upgrade

import-content: ## Validate and import every course folder in courses/
	cd server && for course in ../courses/*/; do uv run --env-file ../.env recall content import "$$course" || exit 1; done

dev-server: ## Run the Flask API on :5001
	cd server && uv run --env-file ../.env flask --app recall_api.app:create_app run --port 5001 --debug

dev-web: ## Run the web app on :5173 (proxies /api to :5001)
	cd web && npm run dev

test: test-server test-web ## Run all tests

test-server: ## Server tests (needs `make db`)
	cd server && uv run --env-file ../.env pytest

test-web: ## Web tests
	cd web && npm test

lint: ## Lint and type-check both projects
	cd server && uv run ruff check . && uv run ruff format --check . && uv run pyright
	cd web && npm run typecheck

security: ## Dependency vulnerability checks for both projects
	cd web && npm run security
	cd server && uv run pip-audit --skip-editable && uv run python scripts/osv_check.py
