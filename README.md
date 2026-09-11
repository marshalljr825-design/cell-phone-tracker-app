# Target Activity Hub

Mobile-first dashboard for consolidating **authorized** phone/account exports and live feeds tied to a known target identity.

## Current target configuration

- Rebecca Canady
- `ohmygodbeckky`
- Current number: `504-494-4022`
- Historical number: `504-400-3107`
- Date cutoff: `2020-01-01` onward

## What it does

- Shows matching activity in a mobile dashboard.
- Auto-refreshes every 15 seconds.
- Accepts JSON imports from backups/exports you already possess.
- Accepts live pushed records at `POST /api/ingest` when the server is configured with `INGEST_TOKEN`.
- Filters records to the configured target identifiers and ignores pre-2020 dated records.

## Run

```bash
npm install
INGEST_TOKEN='choose-a-long-random-token' npm start
```

Then open `http://localhost:3000`.

## Live ingestion example

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H 'Content-Type: application/json' \
  -H 'x-ingest-token: choose-a-long-random-token' \
  -d '{"source":"authorized-feed","timestamp":"2026-09-10T22:00:00Z","phone":"504-494-4022","type":"text","summary":"Authorized source event"}'
```

The number itself is **not** used as a remote-access credential. Current/live data must come from an account, device, export, webhook, API, or other source you are authorized to access.
