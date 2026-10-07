# OnBoard.in - Realtime Clipboard

Create a room, share the 6-character code (or QR code / link), and text or images sync in realtime across devices.

## Run locally

Backend (needs MongoDB):

```
cd backend
pip install -r requirements.txt
uvicorn server:app --port 8000
```

`backend/.env`:

```
MONGO_URL=mongodb://localhost:27017
DB_NAME=onboard
CORS_ORIGINS=http://localhost:3000
```

Frontend:

```
cd frontend
npm install
npm start
```

`frontend/.env`:

```
REACT_APP_BACKEND_URL=http://localhost:8000
```

## Deploying

- `REACT_APP_BACKEND_URL` is baked in at build time. Set it to the public backend URL (e.g. `https://api.example.com`) before `npm run build`. If it is not set, the app talks to the origin it is served from.
- Set `CORS_ORIGINS` on the backend to the frontend's origin(s), comma separated.
- The host/proxy in front of the backend must allow WebSocket upgrades on `/ws/`. If it doesn't, the app still works through HTTP polling, just slower.
- Frontend on Vercel: import the repo and set the project's Root Directory to `frontend`. `frontend/vercel.json` already has the install/build commands and cache headers. Add `REACT_APP_BACKEND_URL` under Environment Variables and redeploy after changing it.
- The backend cannot run on Vercel (it needs a long-running process for WebSockets and in-memory rooms). It is set up for Render through `render.yaml`:
  1. Create a MongoDB database (e.g. a free Atlas cluster). In Atlas > Network Access allow `0.0.0.0/0`, since Render's outbound addresses are not fixed.
  2. In Render: New > Blueprint > pick this repo. Enter `MONGO_URL` (the connection string) and `CORS_ORIGINS` (your Vercel URL, e.g. `https://your-app.vercel.app`, no trailing slash).
  3. Copy the service URL Render gives you (`https://....onrender.com`) into `REACT_APP_BACKEND_URL` on Vercel and redeploy the frontend.
  - The blueprint uses the free plan, which sleeps after 15 minutes without traffic and takes up to a minute to wake. Change `plan` in `render.yaml` for real users.
- Serve the frontend over HTTPS. Copy buttons, the service worker and "Add to Home Screen" only work on HTTPS (or localhost).
- On the static host, turn on gzip/brotli and set these cache headers:
  - `/static/*` - `Cache-Control: public, max-age=31536000, immutable` (file names contain a content hash)
  - `/index.html` and `/service-worker.js` - `Cache-Control: no-cache`, so a new deploy is picked up on the next visit
- `public/service-worker.js` caches the app's own files so repeat visits start instantly. It never caches `/api` or `/ws`. It assumes the app is hosted at the root of its domain.
- Run a single backend process (`uvicorn server:app`, no `--workers`). Live room state is kept in memory, so clients connected to different processes would not see each other's changes.
