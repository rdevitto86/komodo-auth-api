.DEFAULT_GOAL := bootstrap

APP_NAME := komodo-auth-api

ENVS := local dev staging prod
ENV_FROM_GOALS := $(strip $(filter $(ENVS),$(MAKECMDGOALS)))
ifneq ($(ENV_FROM_GOALS),)
  ENV := $(ENV_FROM_GOALS)
else
  ENV ?= local
endif
ENV := $(strip $(ENV))
TAG ?= $(ENV)

DOCKERFILE := Dockerfile
COMPOSE_FILE := docker-compose.yaml
MEM_LIMIT ?= 512M
LOG_LEVEL ?= error
RESTART_POLICY ?= unless-stopped

ifeq ($(ENV),prod)
  RESTART_POLICY := always
  MEM_LIMIT := 1g
  DISTROLESS_TAG := nonroot
  SECRET_PATH := komodo/prod/auth-api
  CUSTOMER_API_URL := http://customer-api-public.komodo-prod.local:7052
  COMMS_API_URL := http://communications-api.komodo-prod.local:7081
else ifeq ($(ENV),staging)
  MEM_LIMIT := 1g
  DISTROLESS_TAG := nonroot
  SECRET_PATH := komodo/staging/auth-api
  CUSTOMER_API_URL := http://customer-api-public.komodo-stg.local:7052
  COMMS_API_URL := http://communications-api.komodo-stg.local:7081
else ifeq ($(ENV),dev)
  LOG_LEVEL := info
  DISTROLESS_TAG := debug
  SECRET_PATH := komodo/dev/auth-api
  CUSTOMER_API_URL := http://customer-api-public.komodo-dev.local:7052
  COMMS_API_URL := http://communications-api.komodo-dev.local:7081
else
  RESTART_POLICY := no
  LOG_LEVEL := debug
  DISTROLESS_TAG := debug
  SECRET_PATH := komodo/local/auth-api
  CUSTOMER_API_URL := http://customer-api-public:7052
  COMMS_API_URL := http://communications-api:7081
endif

OAPI_CODEGEN_VERSION := v2.7.1-0.20260518235555-9bb79e703422
OAPI_CODEGEN := go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@$(OAPI_CODEGEN_VERSION)

COMPOSE_ENV := VERSION=$(TAG) \
	LOG_LEVEL=$(LOG_LEVEL) \
	RESTART_POLICY=$(RESTART_POLICY) \
	MEM_LIMIT=$(MEM_LIMIT) \
	DISTROLESS_TAG=$(DISTROLESS_TAG) \
	APP_ENV=$(ENV) \
	SECRET_PATH=$(SECRET_PATH) \
	CUSTOMER_API_URL=$(CUSTOMER_API_URL) \
	COMMS_API_URL=$(COMMS_API_URL)

define PROD_GUARD
$(if $(filter prod,$(ENV)),$(error Production containers must not run locally. Use CI/CD or 'make deploy prod'.))
endef

.PHONY: build run bootstrap stop restart clean test test_unit test_component lint generate generate-check help generate-server generate-client-comms generate-client-customer generate-mocks deploy diagrams diagrams-clean $(ENVS)

$(ENVS):
	@true

help:
	@echo "Targets:"
	@echo "  build             Build Docker images for ENV ($(ENV))"
	@echo "  run               Start containers via Docker Compose"
	@echo "  bootstrap         Build + run"
	@echo "  stop              Stop containers"
	@echo "  restart           Restart container stack"
	@echo "  clean             Prune Docker artifacts"
	@echo "  deploy            CDK deploy (dev, staging, prod only)"
	@echo "  test              Run unit + component tests with race detector (phase-exit gate)"
	@echo "  test_unit         Run unit tests only (-short, fast local iteration)"
	@echo "  test_component    Run component-tier tests with race detector"
	@echo "  lint              Run golangci-lint"
	@echo "  generate          Run all code generation targets"
	@echo "  generate-check    Run generate and verify no diff"
	@echo "  diagrams          Render docs/diagrams/*.mmd to PNG (requires mmdc)"
	@echo "  diagrams-clean    Remove generated PNGs from docs/diagrams/"
	@echo ""
	@echo "Usage: make <target> [local|dev|staging|prod]    (default: local)"
	@echo ""
	@echo "Examples:"
	@echo "  make bootstrap          local env (build + run)"
	@echo "  make bootstrap dev      build + run against live DEV AWS"
	@echo "  make deploy staging     CDK deploy to staging"
	@echo ""
	@echo "Environments:"
	@echo "  local   — graceful degradation; no backing services required"
	@echo "  dev     — real AWS; pass AWS creds via environment"
	@echo "  staging — real AWS; pass AWS creds via environment"
	@echo "  prod    — deploy only via CDK; run/build/bootstrap blocked"

build:
	$(PROD_GUARD)
	@echo "Building $(APP_NAME):$(TAG) for ENV=$(ENV)"
	@docker build \
		-f $(DOCKERFILE) \
		-t $(APP_NAME)-public:$(TAG) \
		--build-arg BUILD_TARGET=public \
		--build-arg DISTROLESS_TAG=$(DISTROLESS_TAG) \
		..
	@docker build \
		-f $(DOCKERFILE) \
		-t $(APP_NAME)-private:$(TAG) \
		--build-arg BUILD_TARGET=private \
		--build-arg DISTROLESS_TAG=$(DISTROLESS_TAG) \
		..

run:
	$(PROD_GUARD)
	@echo "Starting $(APP_NAME) for ENV=$(ENV)"
	@docker network create komodo-network 2>/dev/null || true
	@$(COMPOSE_ENV) \
	docker compose -p $(APP_NAME)-$(ENV) -f $(COMPOSE_FILE) up -d

stop:
	@echo "Stopping $(APP_NAME) for ENV=$(ENV)"
	@docker compose -p $(APP_NAME)-$(ENV) -f $(COMPOSE_FILE) down --remove-orphans

ifeq ($(ENV),prod)
bootstrap:
	$(PROD_GUARD)
else
bootstrap: build run
endif

restart: stop run

deploy:
	$(if $(filter local,$(ENV)),$(error No CDK deploy for local environment. Use 'make bootstrap' instead.))
	@echo "Deploying $(APP_NAME) via CDK for ENV=$(ENV)..."
	@cd deploy/cdk && bun install && npx cdk deploy -c env=$(if $(filter staging,$(ENV)),stg,$(ENV))

clean:
	docker container prune -f
	docker image prune -f
	docker network prune -f
	docker volume prune -f

test: test_component

test_unit:
	go test -short ./...

test_component:
	TEST_TIER=component go test -race ./...

lint:
	@golangci-lint run ./...

generate-server:
	@cd internal/models && $(OAPI_CODEGEN) -config oapi-codegen.yaml ../../openapi.yaml

generate-client-comms:
	@cd internal/models/comms && $(OAPI_CODEGEN) -config oapi-codegen.yaml ../../../../komodo-communications-api/openapi.yaml

generate-client-customer:
	@cd internal/models/user && $(OAPI_CODEGEN) -config oapi-codegen.yaml ../../../../komodo-customer-api/openapi.yaml

generate-mocks:
	@go generate ./...

generate: generate-server generate-client-comms generate-client-customer generate-mocks

generate-check: generate
	@git diff --exit-code -- internal/models internal/testutil/mocks \
		|| (echo "Generated files are stale. Run 'make generate' and commit." && exit 1)

DIAGRAM_DIR := docs/diagrams
DIAGRAM_SRC := $(wildcard $(DIAGRAM_DIR)/*.mmd)
DIAGRAM_OUT := $(DIAGRAM_SRC:.mmd=.png)

diagrams: $(DIAGRAM_OUT)

$(DIAGRAM_DIR)/%.png: $(DIAGRAM_DIR)/%.mmd
	@command -v mmdc >/dev/null || { echo "mmdc not installed. Run: npm i -g @mermaid-js/mermaid-cli"; exit 1; }
	@echo "rendering $<"
	@mmdc -i $< -o $@ -b white -s 2 >/dev/null

diagrams-clean:
	@rm -f $(DIAGRAM_DIR)/*.png
