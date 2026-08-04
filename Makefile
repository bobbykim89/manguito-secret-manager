.DEFAULT_GOAL := help
.PHONY: help db-up db-down test lint

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

db-up: ## Start local Postgres
	docker compose up -d --wait postgres

db-down: ## Stop local Postgres
	docker compose down

test: ## Run backend tests
	cd api && uv run pytest

lint: ## Run backend linters
	cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app
