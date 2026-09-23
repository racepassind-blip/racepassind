const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8010").replace(/\/$/, "");
export const API_BASE = `${API_ORIGIN}/api/v1`;
const API_REQUEST_TIMEOUT_MS = 15_000;

let unauthorizedHandler: (() => void) | null = null;
let activeApiRequests = 0;
const apiLoadingListeners = new Set<() => void>();

function notifyApiLoadingListeners() {
  apiLoadingListeners.forEach((listener) => listener());
}

function beginApiRequest() {
  activeApiRequests += 1;
  notifyApiLoadingListeners();
}

function endApiRequest() {
  activeApiRequests = Math.max(0, activeApiRequests - 1);
  notifyApiLoadingListeners();
}

export function subscribeToApiLoading(listener: () => void) {
  apiLoadingListeners.add(listener);
  return () => apiLoadingListeners.delete(listener);
}

export function isApiLoading() {
  return activeApiRequests > 0;
}

export async function trackApiRequest<T>(request: () => Promise<T>): Promise<T> {
  beginApiRequest();
  try {
    return await request();
  } finally {
    endApiRequest();
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly isCsrfError: boolean;

  constructor(status: number, message: string, requestId: string | null = null, isCsrfError = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.isCsrfError = isCsrfError;
  }
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// ---------------------------------------------------------------------------
// CSRF token — double-submit cookie pattern
//
// In production the frontend and backend live on different origins.  The
// backend sets the `racepass_csrf` cookie (httponly=false, SameSite=none,
// Secure) so the browser sends it automatically with credentialed requests,
// but JavaScript on the *frontend* origin cannot read it via document.cookie
// because it belongs to the *backend* origin.
//
// Strategy:
//   1. Try document.cookie (works when both origins share a domain / localhost).
//   2. Fall back to the in-memory cache (populated from every API response body
//      that contains a `csrfToken` field, and from /auth/csrf fetch below).
//   3. Fetch GET /auth/csrf with credentials — the backend echoes the current
//      cookie value in the JSON body, then we cache it in memory.
//
// Race-safety: a single in-flight promise is shared across concurrent callers
// so we never fire multiple simultaneous /auth/csrf requests, each of which
// could clobber the cookie with a different random value.
//
// Stale-token safety: clearCsrfToken() wipes the in-memory value so that any
// stale token left over from an expired session is never reused after logout.
// ---------------------------------------------------------------------------

let inMemoryCsrfToken: string | null = null;
// Promise lock: if a /auth/csrf fetch is already in-flight, subsequent callers
// wait on the same promise instead of launching a parallel one.
let csrfFetchPromise: Promise<string | null> | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  if (token) inMemoryCsrfToken = token;
}

/** Called on logout / session clear so a stale token is never reused. */
export function clearCsrfToken(): void {
  inMemoryCsrfToken = null;
  csrfFetchPromise = null;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

async function fetchCsrfFromBackend(): Promise<string | null> {
  // If another caller already kicked off the fetch, piggyback on that promise.
  if (csrfFetchPromise) return csrfFetchPromise;

  csrfFetchPromise = (async (): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" });
      if (response.ok) {
        const data = (await response.json()) as { csrfToken?: string };
        if (data.csrfToken) {
          inMemoryCsrfToken = data.csrfToken;
          return inMemoryCsrfToken;
        }
      }
    } catch {
      // Network error — let the caller's request proceed without a token;
      // the server will return 403 which triggers a single retry below.
    } finally {
      // Allow a new fetch next time the token is missing rather than
      // holding a stale promise reference forever.
      csrfFetchPromise = null;
    }
    return null;
  })();

  return csrfFetchPromise;
}

export async function resolveCsrfToken(): Promise<string | null> {
  // Level 1 — cookie readable by JS (same-origin or shared domain)
  const cookieToken = readCookie("racepass_csrf");
  if (cookieToken) return cookieToken;

  // Level 2 — in-memory cache (survives between requests in same page load,
  // populated from response bodies and from the /auth/csrf fetch below)
  if (inMemoryCsrfToken) return inMemoryCsrfToken;

  // Level 3 — ask the backend; race-safe via shared promise
  return fetchCsrfFromBackend();
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => {
        if (typeof item !== "object" || item === null) return String(item);
        const validation = item as { loc?: unknown[]; msg?: unknown };
        const location = Array.isArray(validation.loc) ? validation.loc.filter((part) => part !== "body").join(".") : "request";
        return `${location}: ${String(validation.msg ?? "Invalid value")}`;
      });
      if (messages.length > 0) return messages.join("; ");
    }
  }
  return fallback;
}

function isCsrfDetail(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "string" && detail.toLowerCase().includes("csrf");
}

async function executeRequest(
  path: string,
  options: RequestInit,
  csrfToken: string | null,
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  const isFormData = options.body instanceof FormData;

  if (options.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", crypto.randomUUID());

  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);

  // Resolve a CSRF token upfront for mutations, but don't block GET requests.
  let csrfToken: string | null = isMutation ? await resolveCsrfToken() : null;

  const requestController = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => requestController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) requestController.abort();
    else externalSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeoutId = setTimeout(() => requestController.abort(), API_REQUEST_TIMEOUT_MS);

  beginApiRequest();
  try {
    let response = await executeRequest(path, { ...options, signal: requestController.signal }, csrfToken);
    let body = await readResponseBody(response);

    // -----------------------------------------------------------------------
    // CSRF auto-recovery: if the server says 403 with a CSRF-related detail,
    // it means our token was stale or missing.  Wipe the in-memory cache,
    // fetch a fresh token from /auth/csrf, and retry the original request
    // exactly once.  This silently recovers from:
    //   - page reloads before /auth/me resolves
    //   - session expiry leaving a stale in-memory token
    //   - concurrent first-mutation race where the cached token diverged
    // -----------------------------------------------------------------------
    if (response.status === 403 && isMutation && isCsrfDetail(body)) {
      clearCsrfToken();
      csrfToken = await fetchCsrfFromBackend();
      if (csrfToken) {
        // New inner controller — original timeout is already ticking
        response = await executeRequest(path, { ...options, signal: requestController.signal }, csrfToken);
        body = await readResponseBody(response);
      }
    }

    // Cache fresh CSRF token from any response body that carries one.
    if (typeof body === "object" && body !== null && "csrfToken" in body) {
      setCsrfToken((body as { csrfToken?: string }).csrfToken);
    }

    if (response.status === 401) unauthorizedHandler?.();

    if (!response.ok) {
      const requestId = response.headers.get("X-Request-ID");
      const iscsrf = response.status === 403 && isCsrfDetail(body);
      throw new ApiError(response.status, errorMessage(body, `Request failed (${response.status})`), requestId, iscsrf);
    }

    return body as T;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", forwardAbort);
    endApiRequest();
  }
}

export async function uploadFile<T>(path: string, file: File, fieldName = "file"): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);
  try {
    return await apiRequest<T>(path, { method: "POST", body: formData });
  } catch (error) {
    if (error instanceof ApiError) {
      const requestSuffix = error.requestId ? ` (request ${error.requestId})` : "";
      throw new ApiError(error.status, `Upload failed: ${error.message}${requestSuffix}`, error.requestId);
    }
    throw new Error(`Upload failed: ${error instanceof Error ? error.message : "Unknown upload error"}`);
  }
}
