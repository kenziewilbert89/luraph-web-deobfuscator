FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pull the Luraph V15 engine into the container image.
RUN git clone --depth 1 https://github.com/caomod2077/Deobfuscator-Luraph-V15.git /app/engine \
  && cd /app/engine \
  && npm install

WORKDIR /app/server

COPY container/package.json ./
RUN npm install --omit=dev

COPY container/server.js ./

RUN mkdir -p /tmp/uploads /tmp/luraph-jobs

EXPOSE 8080

CMD ["node", "server.js"]
