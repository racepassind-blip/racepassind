import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { WhatsAppSupportButton } from "./WhatsAppSupportButton";

export function Layout({ children, raisedSupportButton = false, hideSupportButton = false }: { children: React.ReactNode; raisedSupportButton?: boolean; hideSupportButton?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      <Footer />
      {!hideSupportButton && <WhatsAppSupportButton raisedOnMobile={raisedSupportButton} />}
    </div>
  );
}
