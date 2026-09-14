const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8010").replace(/\/$/, "");
const API_BASE = `${API_ORIGIN}/api/v1`;
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

  constructor(status: number, message: string, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
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

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  const isFormData = options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("X-CSRF-Token")) {
    const csrfToken = readCookie("racepass_csrf");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", crypto.randomUUID());

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
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers,
      signal: requestController.signal,
    });
    const body = await readResponseBody(response);

    if (response.status === 401) unauthorizedHandler?.();
    if (!response.ok) {
      throw new ApiError(response.status, errorMessage(body, `Request failed (${response.status})`), response.headers.get("X-Request-ID"));
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
