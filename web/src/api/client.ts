/**
 * API client for Lediary backend.
 * Dev: Vite proxy /api → localhost:8080.
 * Prod: Direct to Cloud Run URL.
 */

import { getIdToken } from '../auth';

const API_BASE = import.meta.env.DEV
  ? '/api'
  : 'https://lediary-api-121737888244.asia-northeast1.run.app/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
