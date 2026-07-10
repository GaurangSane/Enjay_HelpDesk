import os
import backend.config  # noqa: F401 — loads .env via absolute path before anything else
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import tickets, webhooks

app = FastAPI(
    title="Enjay Helpdesk Backend",
    description="FastAPI Backend for AI-Powered Ticket Management System",
    version="1.0.0"
)

# CORS Middleware
origins = [
    "http://localhost:5173",
    "https://your-app.vercel.app",
]

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

@app.get("/health")
def health_check():
    return {"status": "ok"}
