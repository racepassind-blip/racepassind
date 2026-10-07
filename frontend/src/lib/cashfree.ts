type CheckoutResult = { error?: { message?: string }; redirect?: boolean; paymentDetails?: unknown };
type CashfreeInstance = { checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<CheckoutResult> };

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => CashfreeInstance;
  }
}

let loading: Promise<void> | null = null;

export async function launchCashfree(sessionId: string, environment: "sandbox" | "production"): Promise<CheckoutResult> {
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      if (window.Cashfree) { resolve(); return; }
      const script = document.createElement("script");
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Cashfree checkout"));
      document.head.appendChild(script);
    }).catch((error) => { loading = null; throw error; });
  }
  await loading;
  if (!window.Cashfree) throw new Error("Cashfree checkout is unavailable");
  return window.Cashfree({ mode: environment }).checkout({ paymentSessionId: sessionId, redirectTarget: "_self" });
}
