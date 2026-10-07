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
- Run a single backend process (`uvicorn server:app`, no `--workers`). Live room state is kept in memory, so clients connected to different processes would not see each other's changes.
