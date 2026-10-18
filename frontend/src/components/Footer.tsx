import { Link } from "react-router-dom";
import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";

export function Footer() {
  const whatsappUrl = createWhatsAppUrl(WHATSAPP_MESSAGES.generalSupport);

  return (
    <footer className="border-t bg-card">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 space-y-2 sm:space-y-3 lg:col-span-1">
            <Link to="/" className="flex items-center text-lg font-black tracking-tight">
              SportPass <span className="text-primary">India</span>
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Discover sports. Register simply. Show up ready.
              <br />
              Proudly built in Mysuru.
            </p>
          </div>

          {/* About */}
          <div className="order-1 space-y-2 sm:order-none sm:space-y-3">
            <h4 className="font-semibold text-sm">About</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground sm:space-y-2">
              <li><Link to="/our-story" className="hover:text-foreground transition-colors">Our Story</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="order-3 col-span-2 space-y-2 sm:order-none sm:col-span-1 sm:space-y-3">
            <h4 className="font-semibold text-sm">Contact</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground sm:space-y-2">
              <li><a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-foreground transition-colors">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#25D366] text-[10px] font-bold text-white">WA</span>
                Chat with us on WhatsApp
              </a></li>
              <li><a href="mailto:sportpassind@gmail.com" className="hover:text-foreground transition-colors">sportpassind@gmail.com</a></li>
              <li><a href="mailto:sportpassind@gmail.com" className="hover:text-foreground transition-colors">Partner with us</a></li>
            </ul>
          </div>

          {/* Legal */}
          <div className="order-2 space-y-2 sm:order-none sm:space-y-3">
            <h4 className="font-semibold text-sm">Legal</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground sm:space-y-2">
              <li><Link to="/terms-of-service" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link to="/privacy-policy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-start gap-3 border-t pt-5 text-sm text-muted-foreground sm:mt-10 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pt-6">
          <span className="max-w-xs">© 2026 SportPass India. Built for India, built in Mysuru.</span>
          <div className="flex gap-4">
            <a
              href="https://www.instagram.com/sportpassindia/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Instagram
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
