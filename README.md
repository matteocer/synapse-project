# Synapse Spike Wall

Lightweight, dependency-free web app that visualizes 10 synapses (cartoon-style) and lets people join by scanning a QR code. Each phone claims one synapse, is randomly assigned an AMPA or NMDA receptor, can tune biophysical parameters, and can fire spikes in real time.

## Run locally
```bash
# Optional: adjust defaults
# SYNAPSES=10 PORT=3000 HOST=0.0.0.0
node server.js
```

Then open `http://localhost:3000` on a display. Others can scan the QR code shown on the page to connect.

## How it works
- **Server:** plain Node HTTP with Server-Sent Events (no external packages). Tracks a session, assigns synapses, and broadcasts join/leave/spike/parameter events.
- **Display:** `/` shows 10 illustrated synapses with live receptor type (AMPA/NMDA), Ca++ permeability, probability of release, number of synapses, and quantal response. QR is generated client-side.
- **Controller:** `/join/:sessionId` auto-claims the next free synapse, tells you your receptor, lets you adjust the four parameters, and provides a “Fire spike” button.

## Controls
- “Reset session” (on the display) rotates to a fresh session ID/QR and frees all synapses.
- Set `SYNAPSES` to change the number of available synapses (default 10).
- Sliders (controller): Ca++ permeability (0–2), probability of release (0–1), number of synapses (1–10), quantal response (0.1–5).

## Deploy to Vercel
- `vercel` CLI or dashboard will detect `vercel.json`.
- No build step needed; static assets are served from `public/`, API lives in `api/index.js`.
- Important: Server-Sent Events run inside a serverless function with a 60s cap (`maxDuration: 60`), so the EventSource may reconnect roughly once per minute. Real-time spikes still work, but connections will recycle.
- Env vars to set in Vercel: `HOST=0.0.0.0`, `SYNAPSES=10` (optional). `PORT` is provided by Vercel automatically.

## Notes
- Network access is not required for runtime—everything is bundled— but a modern browser with canvas and EventSource support is needed.
