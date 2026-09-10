# SportTicket Hub

## Getting started

```sh
npm i
npm run dev
```

## Scripts

- dev: `npm run dev`
- build: `npm run build`
- test: `npm run test`
- lint: `npm run lint`

## Deployment

For production and preview deployment, see the repository-level [`DEPLOYMENT.md`](../DEPLOYMENT.md). The frontend is built as static assets and receives only the public API origin through `VITE_API_URL`.

```sh
npm ci
VITE_API_URL=https://api-placeholder.example npm run build
```

Configure the static host to publish `dist/` and serve `index.html` as the SPA fallback for client-side routes.
