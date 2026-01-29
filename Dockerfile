FROM node:18-alpine AS builder

WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:18-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/data && \
    chown -R nodejs:nodejs /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

COPY backend/ ./backend/
COPY server.js ./
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN chown -R nodejs:nodejs /app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

USER nodejs

CMD ["node", "server.js"]
