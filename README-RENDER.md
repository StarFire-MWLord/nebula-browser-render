# Render deployment

This package wraps Ultraviolet 3.2.10 in a deployable Node application and adds the Wisp/Epoxy transport needed by the browser client.

## Render settings
- Service type: Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz`
- Environment variable: `NODE_VERSION=24.8.0`

The server reads Render's `PORT` variable and binds to `0.0.0.0`.
