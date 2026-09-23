import { Link } from "react-router-dom";
import { Ticket } from "lucide-react";
import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";

export function Footer() {
  const whatsappUrl = createWhatsAppUrl(WHATSAPP_MESSAGES.generalSupport);

  return (
    <footer className="border-t bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-3">
            <Link to="/" className="flex items-center gap-2 text-lg font-black tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Ticket className="h-4 w-4 text-primary" />
              </span>
              SportPass <span className="text-primary">India</span>
            </Link>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Discover sports. Register simply. Show up ready.
              <br />
              Proudly built in Mysuru.
            </p>
          </div>

          {/* About */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">About</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/our-story" className="hover:text-foreground transition-colors">Our Story</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Contact</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#25D366] text-[10px] font-bold text-white">WA</span>
                Chat with us on WhatsApp
              </a></li>
              <li><a href="mailto:sportpassind@gmail.com" className="hover:text-foreground transition-colors">support@sportpassindia.com</a></li>
              <li><a href="mailto:sportpassind@gmail.com" className="hover:text-foreground transition-colors">Partner with us</a></li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/terms-of-service" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link to="/privacy-policy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© 2026 SportPass India. Built for India, built in Mysuru.</span>
          <div className="flex gap-4">
            <span className="hover:text-foreground cursor-pointer">Twitter</span>
            <span className="hover:text-foreground cursor-pointer">Instagram</span>
            <span className="hover:text-foreground cursor-pointer">LinkedIn</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
