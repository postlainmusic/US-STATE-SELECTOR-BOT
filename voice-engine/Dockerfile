FROM node:22.12.0-bookworm-slim

ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/edge-venv

ENV PATH="/opt/edge-venv/bin:${PATH}"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src

RUN useradd --system --uid 10001 --create-home voicebot \
    && mkdir -p /tmp/postlain-voice \
    && chown -R voicebot:voicebot /app /tmp/postlain-voice

USER voicebot
EXPOSE 3000
CMD ["node", "src/server.js"]
