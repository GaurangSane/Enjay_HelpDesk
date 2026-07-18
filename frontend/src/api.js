/**
 * api.js — Enjay Helpdesk
 * ──────────────────────────────────────────────────────────────────────────
 * Single source of truth for the backend API base URL.
 *
 * Local dev:   set VITE_API_BASE_URL in frontend/.env (e.g. http://localhost:8000)
 * Production:  set VITE_API_BASE_URL in Vercel project settings
 *              (e.g. https://enjay-backend.up.railway.app)
 *
 * Usage:
 *   import { apiUrl } from '../api';
 *   const res = await fetch(apiUrl('/tickets/'));
 */

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/**
 * Builds an absolute URL to the backend API.
 * @param {string} path - Must start with /  (e.g. '/tickets/')
 * @returns {string}
 */
export function apiUrl(path) {
  return `${BASE}${path}`;
}
