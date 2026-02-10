FROM node:20-slim AS builder

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source code and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --omit=dev

# Copy prisma schema for migrations
COPY prisma ./prisma
RUN npx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy and prepare startup script
COPY start.sh ./
RUN chmod +x start.sh

# Railway sets PORT env var, default to 8080
ENV PORT=8080
EXPOSE 8080

# Use startup script
CMD ["./start.sh"]
