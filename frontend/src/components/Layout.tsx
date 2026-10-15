import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { WhatsAppSupportButton } from "./WhatsAppSupportButton";
import { EventNavigation } from "./EventNavigation";

export function Layout({ children, raisedSupportButton = false }: { children: React.ReactNode; raisedSupportButton?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none"><EventNavigation />{children}</main>
      <Footer />
      <WhatsAppSupportButton raisedOnMobile={raisedSupportButton} />
    </div>
  );
}
