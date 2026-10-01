ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.9
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/store/package.json ./packages/store/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/react/package.json ./packages/react/package.json
COPY packages/adapters/package.json ./packages/adapters/package.json
COPY packages/cli/package.json ./packages/cli/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm typecheck && pnpm test
FROM build AS verify
RUN pnpm format:check && pnpm release:pack && pnpm test:next

FROM build AS production-deps
# Retain the dependency versions verified in the build stage.
RUN CI=true pnpm install --prod --offline --frozen-lockfile

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production EVERYLOCALE_HOST=0.0.0.0 EVERYLOCALE_PORT=4310 EVERYLOCALE_DATABASE=/data/everylocale.sqlite
WORKDIR /app
COPY --from=production-deps --chown=node:node /build/node_modules/ ./node_modules/
COPY --from=production-deps --chown=node:node /build/packages/ ./packages/
COPY LICENSE ./LICENSE
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/main.js"]
