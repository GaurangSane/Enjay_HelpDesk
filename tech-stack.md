# AI-Powered Ticket Management System: Tech Stack

This document outlines the modern, fast, and free (or generous free tier) technology stack chosen to build the AI-Powered Ticket Management System.

## 1. Backend & AI Orchestration
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (Python)
  - Industry standard for AI applications, incredibly fast, and asynchronous by default.
- **AI Framework:** [LlamaIndex](https://www.llamaindex.ai/) or Native SDKs
  - Ideal for complex RAG workflows, document parsing, and semantic chunking.
- **Async Processing:** [Celery](https://docs.celeryq.dev/) + [Redis](https://redis.io/)
  - Replaces bare FastAPI `BackgroundTasks` to provide a durable, production-grade background job scheduler. Celery handles the sweeper cron jobs, LLM rate-limit queuing, and heavy RAG pipeline execution, ensuring no tasks are lost during server restarts.

## 2. Database & Vector Storage
- **Relational Database:** [PostgreSQL](https://www.postgresql.org/) (via [Supabase](https://supabase.com/))
  - Acts as the primary source of truth for tickets, users, and system data. Supabase provides instant APIs and real-time capabilities.
- **Authentication & Authorization:** Supabase Auth
  - Secures the dashboard using Row Level Security (RLS) in Postgres. Enforces role-based access control (RBAC), distinguishing between standard `Agent` and `Admin` permissions.
- **Vector Database:** [Qdrant](https://qdrant.tech/)
  - A blazing-fast, Rust-based vector database with native out-of-the-box support for Hybrid Search (Dense + Sparse/BM25).
- **Embedding Model:** Google `text-embedding-004` (768 dimensions)
  - A fixed, specific embedding model chosen for its high semantic accuracy and generous free tier. Enforcing a strict 768-dimension vector prevents future model-upgrade poisoning.
- **Database Syncing:** Cross-database UUID mapping
  - We will implement strict cross-database UUID mapping to bridge Supabase relational records (e.g., ticket IDs, article IDs) directly to Qdrant vector metadata, ensuring perfect synchronization between semantic data and relational state.

## 3. Frontend Dashboard
- **Framework:** [Vite](https://vitejs.dev/) + React (or [Next.js](https://nextjs.org/))
  - Provides an insanely fast development experience for a modern Single Page Application (SPA) dashboard.
- **Styling:** Vanilla CSS
  - Custom Vanilla CSS will be used to create a premium, state-of-the-art aesthetic (glassmorphism, micro-animations, rich dark modes) for maximum control and performance.

## 4. LLM Provider
- **Providers:** [Groq](https://groq.com/) or [Google Gemini API](https://aistudio.google.com/)
  - **Groq:** Run open-source models (like Llama 3) on LPUs for mind-blowing speeds (~800 tokens/sec) with an excellent developer free tier.
  - **Gemini:** Generous free tier offering massive context windows, perfect for parsing large technical troubleshooting documents.

## 5. Integrations & Ingestion
- **Email Ingestion:** [Resend](https://resend.com/) or [SendGrid](https://sendgrid.com/) Inbound Parse Webhooks
  - Reliable parsing of incoming support emails, instantly firing webhooks to our FastAPI backend to convert them into standardized tickets.

## 6. Production Hosting & Monitoring
- **Backend Hosting:** [Render](https://render.com/) or [Railway](https://railway.app/)
  - Perfect for deploying the FastAPI server, Celery worker processes, and the Redis broker together with minimal DevOps overhead.
- **Frontend Hosting:** [Vercel](https://vercel.com/)
  - The industry standard for hosting React/Vite/Next.js dashboards, providing global CDN edge caching and PR preview environments.
- **Error Tracking & APM:** [Sentry](https://sentry.io/)
  - Deeply integrated into FastAPI and the React frontend to catch untracked exceptions, trace RAG pipeline latency, and alert the team instantly if a webhook drops.
