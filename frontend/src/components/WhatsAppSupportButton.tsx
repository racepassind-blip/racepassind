import { WhatsApp } from "lucide-react";
import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";

/**
 * Floating WhatsApp support button for public pages.
 * Opens a new tab with WhatsApp and a pre-filled message.
 */
export function WhatsAppSupportButton() {
  const whatsappUrl = createWhatsAppUrl(WHATSAPP_MESSAGES.generalSupport);

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with SportPass on WhatsApp"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95 hover:bg-[#20bd5a] focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2 dark:focus:ring-offset-slate-950 lg:bottom-8 lg:right-8"
    >
      <WhatsApp className="h-5 w-5" />
      <span className="hidden sm:inline">Chat with us</span>
    </a>
  );
}
