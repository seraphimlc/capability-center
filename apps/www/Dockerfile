FROM node:22-alpine
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY services/api/package.json ./services/api/package.json
# Composer helpers are vendored at apps/www/src/lib/chat-ux.ts (keep in sync with
# services/api/src/chat-ux.ts). Do not import or COPY that API file: www build
# must succeed without services/api source in the image.
COPY apps/www ./apps/www
COPY apps/admin/package.json ./apps/admin/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cc/www build
WORKDIR /app/apps/www
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["pnpm", "start"]
