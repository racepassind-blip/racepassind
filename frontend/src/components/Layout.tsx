import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { WhatsAppSupportButton } from "./WhatsAppSupportButton";

export function Layout({ children, raisedSupportButton = false }: { children: React.ReactNode; raisedSupportButton?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppSupportButton raisedOnMobile={raisedSupportButton} />
    </div>
  );
}
