FROM node:22-alpine
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY services/api/package.json ./services/api/package.json
COPY apps/admin ./apps/admin
COPY apps/www/package.json ./apps/www/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cc/admin build
WORKDIR /app/apps/admin
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3001
CMD ["pnpm", "start"]
