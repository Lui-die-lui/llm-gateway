# One image, one service: the gateway API and the admin console (built here, served by the gateway).

FROM node:22-slim AS console
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
# Empty = same origin: the console calls the gateway it is served from, so there is no CORS and no address to configure.
ENV VITE_GATEWAY_URL=""
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY industries ./industries
COPY vendor ./vendor
COPY --from=console /build/dist ./console
# Policy and audit data live in /app/data: mount a persistent volume there. Run ONE process (the applied policy is cached in memory).
ENV AUDIT_DB=/app/data/audit.db POLICY_DB=/app/data/policy.db CONSOLE_DIR=/app/console
EXPOSE 8000
# Hosts such as Railway and Render set PORT; locally it stays 8000.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
