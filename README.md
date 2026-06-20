# HealthSync

HealthSync is a full-stack health data dashboard that connects Fitbit and Withings accounts, syncs wellness metrics, stores normalized data, and shows trends in a React frontend.

It includes:

- A FastAPI backend for OAuth, metric ingestion, and user profile/settings APIs.
- A React + Vite frontend for authentication, dashboards, and metric visualization.
- Background processing for heart-rate threshold checks and email alerts.

## Project Layout

```
HealthSync/
	Backend/    # FastAPI app, DB models, OAuth integrations, worker
	Frontend/   # React + Vite TypeScript UI
	render.yaml # Root Render service definition
```

## Tech Stack

- Backend: FastAPI, SQLAlchemy, Alembic, Celery, Redis
- Frontend: React, TypeScript, Vite, Tailwind
- Data providers: Fitbit OAuth/API, Withings OAuth/API
- Deployment: Render (backend/worker), Vercel (frontend)

## Core Features

- Fitbit and Withings OAuth login flows
- Metric endpoints for activity, sleep, heart rate, HRV, SpO2, temperature, weight, and more
- User profile API (display name, email, HR alert thresholds)
- Background heart-rate threshold monitoring
- Email alerts for threshold violations

## Prerequisites

- Python 3.11+
- Node.js 18+
- npm (or bun/pnpm if you prefer)
- PostgreSQL (or another SQLAlchemy-supported DB configured via URL)
- Redis (required for OAuth state storage and Celery broker/backend)

## 1. Backend Setup (FastAPI)

From the repository root:

```bash
cd Backend
python -m venv .venv
```

Activate virtual environment:

- Windows (PowerShell):

```powershell
.\\.venv\\Scripts\\Activate.ps1
```

- Windows (cmd):

```cmd
.venv\\Scripts\\activate.bat
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create `Backend/.env` and set values:

```env
WITHINGS_CLIENT_ID=...
WITHINGS_REDIRECT_URI=http://localhost:8000/withings/callback-or-your-configured-uri
WITHINGS_CLIENT_SECRET=...

FITBIT_CLIENT_ID=...
FITBIT_REDIRECT_URI=http://localhost:8000/fitbit/callback-or-your-configured-uri
FITBIT_CLIENT_SECRET=...

SQLALCHEMY_DATABASE_URL=postgresql+psycopg2://user:password@host:5432/dbname
APP_SECRET_KEY=change-me

REDIS_URL=redis://localhost:6379/0

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=your-email@example.com
```

Run backend server:

```bash
uvicorn app.main:app --reload
```

Backend URL (default): `http://127.0.0.1:8000`

API docs:

- Swagger UI: `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

## 2. Frontend Setup (React + Vite)

From the repository root:

```bash
cd Frontend
npm install
```

Create `Frontend/.env`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

Run frontend:

```bash
npm run dev
```

Frontend URL (default): `http://127.0.0.1:5173`

## 3. Run Background Worker (Celery)

In a separate terminal (inside `Backend` with venv activated):

```bash
python worker.py
```

The worker uses `REDIS_URL` as both broker and result backend.

## Common API Route Groups

The backend includes route groups such as:

- Fitbit auth: `/fitbit/*`
- Fitbit metrics: `/fitbit/metrics/*`
- Withings auth: `/withings/*`
- Withings metrics: `/withings/metrics/*`
- User profile/settings: `/users/by-auth/{auth_user_id}`

Use `/docs` for the full endpoint list and schemas.

## Local Development Notes

- The backend CORS configuration currently allows `https://health-sync-web.vercel.app`.
- For local frontend development, you may need to add `http://localhost:5173` (or your frontend origin) to allowed origins in `Backend/app/main.py`.
- OAuth redirect URIs in Fitbit/Withings developer portals must exactly match your configured `*_REDIRECT_URI` values.

## Deployment

### Backend on Render

- Current Render manifests exist at:
  - `render.yaml` (root)
  - `Backend/render.yaml` (web + worker definition)
- Ensure all required environment variables are configured in Render.

### Frontend on Vercel

- Frontend project is in `Frontend/` and includes `Frontend/vercel.json`.
- Set `VITE_API_URL` in Vercel environment variables to your deployed backend URL.

## Troubleshooting

- 401 from provider APIs:
  - Access token expired/invalid. Trigger refresh flow or reconnect provider.
- CORS errors in browser:
  - Add local frontend origin to backend allowed origins.
- Celery not processing:
  - Verify `REDIS_URL` is reachable and worker process is running.
- No email alerts:
  - Check SMTP credentials and sender configuration.
