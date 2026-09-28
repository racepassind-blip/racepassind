import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export async function downloadMerchQr(qrDataUrl: string, orderId: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("QR image unavailable"));
    image.src = qrDataUrl;
  });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 512, 512);
  context.drawImage(image, 0, 0, 512, 512);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not create PNG")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sportpass-merch-qr-${orderId}.png`;
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function MerchQrDownload({ qrDataUrl, orderId }: { qrDataUrl?: string; orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const download = async () => {
    if (!qrDataUrl) return;
    setBusy(true); setError(false); setSaved(false);
    try { await downloadMerchQr(qrDataUrl, orderId); setSaved(true); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm">
    <p className="font-semibold">Pay using this QR image</p>
    <p className="mt-2 leading-6 text-slate-600">Download the QR, then open GPay, PhonePe, Paytm or your UPI app. Choose Scan QR or Upload QR and select the saved image. The QR includes your order amount and reference.</p>
    <Button type="button" className="mt-3 w-full rounded-xl" disabled={busy || !qrDataUrl} onClick={() => void download()}><Download className="mr-2 h-4 w-4" />{busy ? "Preparing QR…" : "Download QR image"}</Button>
    {saved && <p role="status" className="mt-3 text-emerald-700">QR download started. After paying, return here and submit your UTR for organizer verification.</p>}
    {(error || !qrDataUrl) && <p role="alert" className="mt-3 text-red-700">{error ? "Could not download the QR. Please try again, or scan the QR above using another device." : "QR image unavailable. Please contact the organizer."}</p>}
  </div>;
}
