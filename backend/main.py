import os
import backend.config  # noqa: F401 — loads .env via absolute path before anything else
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import sentry_sdk
from backend.routers import tickets, webhooks, kb_articles, analytics, approvals

sentry_sdk.init(
    dsn=os.environ['SENTRY_DSN'],
    traces_sample_rate=0.1,
    environment=os.environ.get('APP_ENV', 'development'),
)

app = FastAPI(
    title="Enjay Helpdesk Backend",
    description="FastAPI Backend for AI-Powered Ticket Management System",
    version="1.0.0"
)

# CORS Middleware
# ALLOWED_ORIGINS is a comma-separated list set in Railway env vars.
# Example: "https://enjay-helpdesk.vercel.app,https://www.enjay.example.com"
# Falls back to localhost only when the var is absent (local dev).
_raw_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173"
    "https://enjay-help-desk.vercel.app"
)
origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(tickets.router)
app.include_router(webhooks.router)
app.include_router(kb_articles.router)
app.include_router(analytics.router)
app.include_router(approvals.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}
