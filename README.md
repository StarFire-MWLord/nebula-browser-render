# Nebula Browser

A Render-ready, browser-style web app with tabs, bookmarks, history, private local mode, search/address bar, themes, and YouTube playback via the official embedded player.

## Important limitation
A normal website cannot act exactly like Chrome/Opera and render every arbitrary third-party site inside itself. Many sites intentionally block framing, and browsers enforce cross-origin security. Nebula therefore opens normal websites in a real browser tab/window. YouTube links are recognized and can play inside Nebula through YouTube's official embed player when the video permits embedding.

## Render deployment
1. Push this repository to GitHub.
2. In Render choose **New > Web Service** and connect the repository.
3. Choose **Docker** as the runtime. Render will use the root `Dockerfile` automatically.
4. Deploy. No build/start command needs to be entered for Docker.
5. Health check path: `/health` (already included in `render.yaml`).

The server binds to `0.0.0.0` and uses Render's `PORT` environment variable.

## Local run
```bash
npm install
npm start
```
Then visit `http://localhost:10000`.

## Privacy
Private mode prevents Nebula's own history/bookmarks from being written to localStorage for that tab. It does **not** make the hosting provider, destination websites, network operator, or external browser tabs unable to observe traffic.
