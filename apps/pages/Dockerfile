FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core curl ca-certificates && rm -rf /var/lib/apt/lists/*
# Offline Vietnamese voice (Piper) = last-resort TTS when the free online voices are down.
ARG TARGETARCH
RUN set -e; arch=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64); \
    mkdir -p /opt/piper && cd /opt/piper \
 && curl -fsSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${arch}.tar.gz" | tar -xz \
 && curl -fsSL -O "https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx" \
 && curl -fsSL -O "https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json"
ENV PIPER_BIN=/opt/piper/piper/piper PIPER_MODEL=/opt/piper/vi_VN-vais1000-medium.onnx
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY functions ./functions
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
