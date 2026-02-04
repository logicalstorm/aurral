FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
ARG APP_VERSION=unknown
ARG GITHUB_REPO=lklynet/aurral
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_GITHUB_REPO=$GITHUB_REPO
RUN cd frontend && npm run build

FROM node:20-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/data && \
    chown -R nodejs:nodejs /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev --ignore-scripts

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --ignore-scripts
RUN cd backend && npm rebuild --build-from-source

COPY backend/ ./backend/
COPY server.js loadEnv.js ./
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN chown -R nodejs:nodejs /app

EXPOSE 3001

USER nodejs

CMD ["node", "server.js"]
