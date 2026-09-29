# Public Luraph Deobfuscator

Production-oriented Docker deployment around the supplied Luraph deobfuscator engine.

## Deploy

### Render
1. Push this folder to GitHub.
2. Create a Render Web Service from the repository.
3. Choose Docker.
4. Deploy. `render.yaml` is included.

### Docker
`docker compose up --build`

The first build compiles Luau and Luau AST for Linux, so the Windows `.exe` files from the original archive are not required.

## API
`POST /api/deobfuscate` with multipart field `file`.

`GET /api/health` returns service health.

## Supported engine
The bundled engine is the supplied Deobfuscator-Luraph-V15 project. Its own README documents Luraph v15 as the primary target and v14.7/v14.8/v14.9 as experimental.

## Security
The public endpoint is rate-limited, size-limited, queued, timed out, and runs inside a non-root container. For a high-traffic service, put the worker behind a separate queue/worker service and add object-storage lifecycle cleanup.
