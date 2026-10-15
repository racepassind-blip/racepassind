import { apiRequest } from "@/lib/api";

type PushConfig = { enabled: boolean; publicKey: string | null };

export type PushPermissionResult =
  | { status: "enabled"; subscriptionId: string }
  | { status: "unsupported" }
  | { status: "home-screen-required" }
  | { status: "denied" };

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function enableEventPush(eventId: string): Promise<PushPermissionResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { status: "unsupported" };
  }
  if (isIos() && !isStandalone()) return { status: "home-screen-required" };

  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") return { status: "denied" };

  const config = await apiRequest<PushConfig>("/push/public-key");
  if (!config.enabled || !config.publicKey) return { status: "unsupported" };
  const registration = await navigator.serviceWorker.register("/push-worker.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(config.publicKey),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return { status: "unsupported" };
  const result = await apiRequest<{ id: string }>("/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      endpoint: json.endpoint,
      keys: json.keys,
      user_agent: navigator.userAgent.slice(0, 512),
    }),
  });
  return { status: "enabled", subscriptionId: result.id };
}

export function registerPushWorker() {
  if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/push-worker.js").catch(() => undefined);
}
