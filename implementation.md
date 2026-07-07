# 7-Day Implementation Plan: AI-Powered Ticket Management System

This document outlines the compressed 7-day build schedule for the Enjay Helpdesk platform, focusing on rapid iteration and core functionality for a production-ready V1.

## Day 1: Foundation & Scaffolding
*   Set up Supabase project (Auth, RLS, SQL schemas for `tickets`, `ticket_messages`, `kb_articles`).
*   Initialize FastAPI backend and Vite + React frontend.
*   Build the basic dashboard skeleton (routing, auth state, layout).

## Day 2: Ingestion & Async Sync Engine
*   Implement Email Webhook ingestion endpoint (Resend/SendGrid) to parse and save to Supabase.
*   Configure Celery & Redis for async task processing.
*   Implement inline vector sync from Supabase to Qdrant (with basic Celery retry on failure, skipping the 5-minute sweeper cron for now).

## Day 3: RAG Foundation & Demo Data
*   Implement format-agnostic chunking (semantic `SentenceSplitter`, 512 tokens) and prompt injection sanitization.
*   Connect to Qdrant and implement Hybrid Search (Dense + Sparse).
*   Seed Qdrant and Supabase with a realistic 20-30 entry demo Knowledge Base to test retrieval.

## Day 4: Core AI Logic (The Brain)
*   Implement the 2-Stage HITL Gate:
    *   **Stage 1:** Vector Distance threshold check.
    *   **Stage 2:** LLM Generation (Confidence Score + Deterministic Citation Validation).
*   Manually tune thresholds based on the demo KB (skipping formal eval framework).

## Day 5: Agent Dashboard & AI Drafts
*   Build the threaded ticket detail view on the frontend.
*   Integrate AI drafts into the UI, highlighting explicit clickable citations to source chunks.
*   Add the Approve / Send action to dispatch the final email.

## Day 6: Continuous Learning Loop & Hardening
*   Build the "Add to Knowledge Base" markdown form in the UI.
*   Implement the Pre-flight Deduplication check (>0.92 similarity) and the Update/Versioning flow (archive old, create new).
*   Apply final premium styling (Vanilla CSS, glassmorphism) to the dashboard.
*   Integrate Sentry for error tracking.

## Day 7: Deployment & Smoke Testing
*   Implement basic exponential retry-on-429 for the LLM (skipping token bucket).
*   Deploy FastAPI + Celery + Redis to Railway/Render.
*   Deploy Vite frontend to Vercel.
*   Conduct full E2E smoke tests (email in -> AI draft -> approve -> send).
