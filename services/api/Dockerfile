FROM node:22-alpine
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY services/api ./services/api
COPY apps/www/package.json ./apps/www/package.json
COPY apps/admin/package.json ./apps/admin/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cc/error-codes build
RUN pnpm --filter @cc/api prisma:generate
RUN pnpm --filter @cc/api build
WORKDIR /app/services/api
ENV PORT=4000
EXPOSE 4000
CMD ["sh", "docker-entrypoint.sh"]
