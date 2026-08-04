.DEFAULT_GOAL := help
.PHONY: help db-up db-down test lint migrate types

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
	cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app
	cd web && npm run lint && npm run typecheck

migrate: ## Apply migrations to the local database
	cd api && uv run alembic upgrade head

types: ## Regenerate web/src/api/generated.ts from the FastAPI schema
	cd api && uv run python scripts/dump_openapi.py > $(CURDIR)/openapi.json
	cd web && npx openapi-typescript $(CURDIR)/openapi.json -o src/api/generated.ts
	rm -f $(CURDIR)/openapi.json
