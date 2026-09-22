import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { WhatsAppSupportButton } from "./WhatsAppSupportButton";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppSupportButton />
    </div>
  );
}
