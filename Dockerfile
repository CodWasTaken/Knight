FROM node:24.17.0-bookworm-slim

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@12.4.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm build

ENV NODE_ENV=production

USER node

CMD ["pnpm", "--filter", "@knight/web", "start"]
