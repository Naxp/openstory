# Hyperframes Render Container

Cloudflare Container that renders Hyperframes HTML compositions to MP4. Reachable
only through the `HYPERFRAMES_RENDER` Durable Object binding in the Worker — not
publicly addressable.

## Runtime

- Node 22 (`node:22-bookworm-slim`)
- Chromium (system package) + FFmpeg
- `@hyperframes/producer` uses the system Chromium via
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

## API

`POST /render` — body:

```json
{
  "compositionId": "frame-01H...",
  "html": "<!doctype html><html>…</html>",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "durationMs": 5000,
  "quality": "standard"
}
```

Response: `200 video/mp4` with the rendered MP4 as the body. The Worker is
responsible for uploading to R2.

`GET /health` — `200 { "ok": true }` for liveness.

## Local development

```bash
cd containers/render
npm install
npm run dev
```

The Worker's dev mode will boot the container automatically via
`wrangler dev` once the `[containers]` binding lands in `wrangler.jsonc`.

## Deploy

`wrangler deploy` builds the image from this `Dockerfile` and publishes it
alongside the Worker.
