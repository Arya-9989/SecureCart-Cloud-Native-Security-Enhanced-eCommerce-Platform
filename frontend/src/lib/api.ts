/**
 * Thin fetch wrapper with in-memory access tokens and silent refresh.
 *
 * - The access token lives only in this module's memory (never localStorage), so an XSS
 *   payload cannot exfiltrate a long-lived credential from storage.
 * - The refresh token is an httpOnly cookie scoped to /api/auth/; the browser attaches it.
 * - On a 401 we refresh once (deduplicated across concurrent requests) and retry.
 */
import type { TokenResponse, User } from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type FieldErrors = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | undefined;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, fields?: FieldErrors, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.body = body;
  }

  /** First message for a (possibly nested) field, e.g. fieldError("shipping_address.city"). */
  fieldError(path: string): string | undefined {
    let node: unknown = this.fields;
    for (const key of path.split(".")) {
      if (node && typeof node === "object" && key in node) {
        node = (node as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    if (Array.isArray(node)) return typeof node[0] === "string" ? node[0] : undefined;
    return typeof node === "string" ? node : undefined;
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<User | null> | null = null;
const sessionListeners = new Set<(user: User | null) => void>();

/**
 * A non-secret "this browser has signed in before" flag. The refresh cookie is httpOnly, so
 * the SPA can't see whether one exists; without this hint every anonymous page load would
 * send a refresh request that is certain to fail with 401. It holds no token or identifier.
 */
export const SESSION_HINT_KEY = "securecart-has-session";

function setSessionHint(present: boolean): void {
  try {
    if (present) localStorage.setItem(SESSION_HINT_KEY, "1");
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* storage blocked: we simply attempt the refresh every time */
  }
}

/** True unless this browser is known never to have signed in (or signed out since). */
export function mayHaveSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

export function setSession(token: string | null): void {
  accessToken = token;
  setSessionHint(token !== null);
}

export function hasSession(): boolean {
  return accessToken !== null;
}

/** Subscribe to session changes caused by refreshes or forced logouts. */
export function onSessionChange(listener: (user: User | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function emit(user: User | null): void {
  sessionListeners.forEach((listener) => {
    listener(user);
  });
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<User | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/api/auth/refresh/`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "X-CSRF-Protection": "1" },
      });
      if (!response.ok) {
        setSession(null);
        return null;
      }
      const data = (await response.json()) as TokenResponse;
      setSession(data.access);
      return data.user;
    } catch {
      accessToken = null;
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the refresh-and-retry dance (used by the auth endpoints themselves). */
  noRetry?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hadToken = accessToken !== null;
  const response = await send(path, options);
  // Only an *expired* token is worth refreshing; anonymous 401s are final.
  if (response.status === 401 && hadToken && !options.noRetry) {
    const user = await refreshSession();
    if (user) {
      emit(user);
      return parse<T>(await send(path, options));
    }
    emit(null);
  }
  return parse<T>(response);
}

function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${BASE}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
    signal: options.signal,
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const envelope = (
      data as { error?: { code?: string; message?: string; fields?: FieldErrors } } | undefined
    )?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? `http_${response.status}`,
      envelope?.message ?? defaultMessage(response.status),
      envelope?.fields,
      data,
    );
  }
  return data as T;
}

function defaultMessage(status: number): string {
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return "Request failed.";
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Network error. Check your connection and try again.";
  return "Something went wrong.";
}
