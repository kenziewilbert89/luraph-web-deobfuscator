# Luraph Cloudflare Container Backend

Files:
- src/index.js -> Worker router
- wrangler.jsonc -> Worker + Container + Durable Object config
- Dockerfile -> builds the deobfuscator container
- container/server.js -> upload/job/progress/download API

Requirements:
- Cloudflare Workers Paid (Containers are not on Free)
- Docker Desktop running for first deployment when using a local Dockerfile
- Node/npm

Deploy:
1. npm install @cloudflare/containers
2. npx wrangler deploy

The container clones caomod2077/Deobfuscator-Luraph-V15 during image build.
