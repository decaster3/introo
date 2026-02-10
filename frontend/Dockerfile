FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build with production settings (mock mode disabled)
ENV VITE_USE_MOCK=false
RUN npm run build

# Production image with nginx
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config template and startup script
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf

# Default port (Railway will override with PORT env var)
ENV PORT=8080

EXPOSE 8080

CMD ["/start.sh"]
