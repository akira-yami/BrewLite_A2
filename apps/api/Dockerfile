# syntax=docker/dockerfile:1.7

FROM node:24.21.0-alpine3.23 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

# One-shot migrations use the CLI from build dependencies.
FROM build AS migration
USER node
CMD ["npm", "run", "prisma:deploy"]

FROM base AS production-dependencies
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3001

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

USER node
EXPOSE 3001

CMD ["node", "dist/main.js"]
