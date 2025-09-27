FROM oven/bun AS builder
WORKDIR /frontend

ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}

COPY bun.lock package.json ./
RUN bun install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun AS runner
WORKDIR /frontend

ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY bun.lock package.json ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /frontend/.next ./.next
COPY --from=builder /frontend/public ./public
