FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY industries ./industries
COPY vendor ./vendor
# Policy and audit data live in /app/data: mount a persistent volume there. Run ONE process (the applied policy is cached in memory).
ENV AUDIT_DB=/app/data/audit.db POLICY_DB=/app/data/policy.db
EXPOSE 8000
# Hosts such as Render set PORT; locally it stays 8000.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
