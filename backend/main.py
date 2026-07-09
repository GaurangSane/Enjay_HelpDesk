import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import tickets, webhooks

app = FastAPI(
    title="Enjay Helpdesk Backend",
    description="FastAPI Backend for AI-Powered Ticket Management System",
    version="1.0.0"
)

# CORS Middleware Configuration
origins = [
    "http://localhost:5173",
    "https://your-app.vercel.app",  # Production frontend placeholder
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
