FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /backend

COPY pyproject.toml ./
COPY uv.lock ./

RUN uv sync --frozen --no-install-project --no-dev

COPY . .

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
