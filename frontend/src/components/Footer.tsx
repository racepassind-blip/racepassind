import { Link } from "react-router-dom";
import { Ticket } from "lucide-react";

export function Footer() {
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
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Team</span></li>
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Careers</span></li>
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Press</span></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Contact</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Support</span></li>
              <li><span className="hover:text-foreground cursor-pointer transition-colors">sportpassind@gmail.com</span></li>
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Partner with us</span></li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Terms of Service</span></li>
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Privacy Policy</span></li>
              <li><span className="hover:text-foreground cursor-pointer transition-colors">Cookie Policy</span></li>
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
