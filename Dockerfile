FROM spaneng/doover_device_base AS base_image
LABEL com.doover.app="true"
LABEL com.doover.managed="true"
HEALTHCHECK --interval=30s --timeout=2s --start-period=5s CMD curl -f "127.0.0.1:$HEALTHCHECK_PORT" || exit 1

## FRONTEND BUILD STAGE ##
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY src/sia_test_bench/frontend/package*.json ./
RUN npm ci
COPY src/sia_test_bench/frontend/ .
RUN npm run build

## FIRST STAGE ##
FROM base_image AS builder

COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# give the app access to our pipenv installed packages
RUN uv venv --system-site-packages
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY . /app

# Copy built frontend from frontend-builder stage
COPY --from=frontend-builder /frontend/dist /app/src/sia_test_bench/frontend/dist

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


## SECOND STAGE ##
FROM base_image AS final_image

COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH"
CMD ["doover-app-run"]
