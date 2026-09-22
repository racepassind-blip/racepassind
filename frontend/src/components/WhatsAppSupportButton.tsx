import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";

/** Official WhatsApp icon as inline SVG */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 0C7.163 0 0 7.163 0 16c0 2.833.738 5.494 2.031 7.8L0 32l8.418-2.007A15.934 15.934 0 0016 32c8.837 0 16-7.163 16-16S24.837 0 16 0zm0 29.333a13.267 13.267 0 01-6.771-1.853l-.485-.29-5.013 1.196 1.25-4.883-.317-.5A13.24 13.24 0 012.667 16C2.667 8.636 8.636 2.667 16 2.667S29.333 8.636 29.333 16 23.364 29.333 16 29.333zm7.27-9.927c-.398-.2-2.358-1.163-2.723-1.296-.364-.133-.63-.2-.896.2-.265.4-1.03 1.296-1.262 1.562-.232.267-.465.3-.863.1-.398-.2-1.682-.62-3.203-1.978-1.184-1.057-1.983-2.362-2.216-2.762-.232-.4-.025-.616.175-.815.18-.178.398-.465.597-.697.2-.233.265-.4.398-.666.133-.267.066-.5-.033-.7-.1-.2-.896-2.162-1.228-2.96-.323-.778-.651-.672-.896-.684-.232-.012-.498-.015-.764-.015s-.697.1-.996.483C9.07 11.17 8 12.333 8 14.128s1.163 3.594 1.329 3.843c.165.25 2.29 3.497 5.546 4.904 3.256 1.408 3.256.938 3.843.879.587-.058 1.892-.773 2.158-1.52.265-.747.265-1.387.185-1.52-.08-.133-.315-.2-.713-.4z" />
    </svg>
  );
}

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
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95 hover:bg-[#20bd5a] focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2 sm:px-5 lg:bottom-8 lg:right-8"
    >
      <WhatsAppIcon className="h-6 w-6 shrink-0" />
      <span className="hidden sm:inline">Chat with us</span>
    </a>
  );
}
