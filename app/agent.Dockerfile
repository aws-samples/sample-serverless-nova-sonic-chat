FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY ./ ./
RUN npx esbuild src/agent/agent-core.ts --bundle --outdir=dist --platform=node --charset=utf8

FROM public.ecr.aws/lambda/nodejs:22 AS runner
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_INSTALL_DIR=/tmp/uv
ENV UV_PROJECT_ENVIRONMENT=/tmp/.venv
ENV UV_PYTHON_INSTALL_DIR=/uv
ENV UV_TOOL_DIR=/tmp/uv/tools
ENV UV_CACHE_DIR=/tmp/uv/cache
RUN uv python install --default

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=builder /build/dist/. ./

ENV NPM_CONFIG_USERCONFIG=/tmp/.npmrc
ENV NPM_CONFIG_CACHE=/tmp/.npm

ENTRYPOINT [ "node" ]
CMD ["agent-core.js"]
