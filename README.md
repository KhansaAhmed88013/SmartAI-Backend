# Smart-AI-Backend

Express + MongoDB API for SmartAI Factory. Provides authentication, machine/device lifecycle, data ingestion via a demo generator, analytics, predictions, insights, and commands.

## Quickstart

```powershell
cd Smart-AI-Backend
npm install

# Demo-friendly env
$env:PORT = '4000'
# If true, `authenticate` assigns an ADMIN user without login (still requires a token on the frontend UI)
$env:DEMO = 'true'
# Faster demo data
$env:DATA_INTERVAL_SECONDS = '2'

npm start
```

By default, an admin account is created on first run:
- Email: `admin@smartai.local` (override with `ADMIN_EMAIL`)
- Password: `adminpass` (override with `ADMIN_PWD`)

Login via `/api/auth/login` to obtain a JWT for the frontend.

## UC-3: Activate & Configure Machine

- Unknown devices auto-register as `PENDING` with a unique `hardwareId`.
- Admin lists pending machines at `GET /api/machines/pending`.
- Admin activates a pending machine with thresholds at `POST /api/machines/:id/activate`.
- Thresholds validated against safe limits; activation is audited in `ActivationEvent`.
- Only `RUNNING` machines are returned by `GET /api/machines` and are considered by alerts, predictions, and insights.

## API Highlights

- `GET /api/machines` → Active (RUNNING) machines only
- `GET /api/machines/pending` → Admin-only pending machines
- `POST /api/machines/:id/activate` → Admin-only activation + thresholds
- `GET /api/kpis/:machineId` → Latest KPIs
- `GET /api/history/:machineId` → Historical sensor data
- `GET /api/predictions/:machineId` → Predictions by horizon
- `GET /api/insights/:machineId` → Insights using thresholds + predictions
- `POST /api/commands` → Queue control commands

## Design Notes

- Duplicate registrations prevented via unique `hardwareId` on `Machine`.
- Pending machines may store data but are ignored for alerts, predictions, and insights.
- Clean separation to swap demo generator with real hardware ingestion later.
