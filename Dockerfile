FROM node:24.17.0-bookworm-slim

ENV COREPACK_HOME=/home/node/.cache/node/corepack

WORKDIR /app

RUN mkdir -p "$COREPACK_HOME" /data/knight-backups \
  && chown -R node:node /home/node/.cache /app /data/knight-backups \
  && corepack enable

COPY --chown=node:node . .

USER node

RUN corepack prepare pnpm@12.4.0 --activate \
  && pnpm install --frozen-lockfile \
  && pnpm build

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@knight/web", "start"]
