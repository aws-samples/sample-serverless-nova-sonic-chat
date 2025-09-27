FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY ./ ./
RUN npx esbuild src/lambda/*.ts --bundle --outdir=dist --platform=node --charset=utf8

FROM public.ecr.aws/lambda/nodejs:22 AS runner
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
RUN uv python install --default

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=builder /build/dist/. ./

ENV UV_NO_CACHE=1
ENV UV_NO_SYNC=1
ENV UV_INSTALL_DIR=/tmp/uv
ENV UV_PROJECT_ENVIRONMENT=/tmp/.venv
ENV NPM_CONFIG_USERCONFIG=/tmp/.npmrc
ENV NPM_CONFIG_CACHE=/tmp/.npm

CMD ["agent.handler"]
