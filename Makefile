# Spaces Makefile - Common commands for development and deployment

.PHONY: help dev build deploy logs clean

help:
	@echo "Available commands:"
	@echo "  make dev          - Start development servers"
	@echo "  make build        - Build for production"
	@echo "  make deploy       - Deploy with docker-compose"
	@echo "  make logs         - View production logs"
	@echo "  make clean        - Clean up containers and volumes"
	@echo "  make db-migrate   - Run database migrations"
	@echo "  make db-studio    - Open Prisma Studio"

# Development
dev:
	@echo "Starting development servers..."
	@cd backend && npm run dev &
	@cd frontend && npm run dev

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev

# Install dependencies
install:
	cd backend && npm install
	cd frontend && npm install
	cd backend && npx prisma generate

# Build
build:
	cd backend && npm run build
	cd frontend && npm run build

# Production deployment with Docker
deploy:
	docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build

deploy-logs:
	docker-compose -f docker-compose.prod.yml logs -f

deploy-stop:
	docker-compose -f docker-compose.prod.yml down

# Database
db-migrate:
	cd backend && npx prisma migrate deploy

db-migrate-dev:
	cd backend && npx prisma migrate dev

db-studio:
	cd backend && npx prisma studio

db-push:
	cd backend && npx prisma db push

# Docker commands
docker-build:
	docker-compose -f docker-compose.prod.yml build

docker-up:
	docker-compose -f docker-compose.prod.yml up -d

docker-down:
	docker-compose -f docker-compose.prod.yml down

docker-logs:
	docker-compose -f docker-compose.prod.yml logs -f

# Cleanup
clean:
	docker-compose -f docker-compose.prod.yml down -v
	docker system prune -f

# Generate secrets
generate-secrets:
	@echo "JWT_SECRET=$$(openssl rand -hex 32)"
	@echo "ENCRYPTION_KEY=$$(openssl rand -hex 32)"
