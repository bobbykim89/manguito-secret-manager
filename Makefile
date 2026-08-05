SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help db-up db-down test lint migrate types install dev

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

db-up: ## Start local Postgres
	docker compose up -d --wait postgres

db-down: ## Stop local Postgres
	docker compose down

test: ## Run backend and frontend tests
	cd api && uv run pytest
	cd web && npm test

lint: ## Run backend and frontend linters
	cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
	cd web && npm run lint && npm run typecheck

migrate: ## Apply migrations to the local database
	cd api && uv run alembic upgrade head

types: ## Regenerate web/src/api/generated.ts from the FastAPI schema
	cd api && uv run python scripts/dump_openapi.py > $(CURDIR)/openapi.json
	cd web && npm exec --no-install openapi-typescript -- $(CURDIR)/openapi.json -o src/api/generated.ts
	rm -f $(CURDIR)/openapi.json

install: ## Install backend and frontend dependencies
	cd api && uv sync
	cd web && npm install

dev: db-up migrate ## Run Postgres, the API with reload, and the Vite dev server
	@echo "API  → http://localhost:8000"
	@echo "Web  → http://localhost:5173"
	@trap 'kill 0' EXIT; \
	(cd api && uv run uvicorn app.main:app --reload --port 8000) & \
	(cd web && npm run dev) & \
	wait -n # return as soon as either server exits, so the trap kills the other instead of leaving it orphaned
