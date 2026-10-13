FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system --gid 10001 optimizer \
    && useradd --system --uid 10001 --gid optimizer --create-home optimizer

COPY main.py ./main.py

USER optimizer
EXPOSE 8001

# Exec keeps Uvicorn as PID 1 so Render's shutdown signal reaches it.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
