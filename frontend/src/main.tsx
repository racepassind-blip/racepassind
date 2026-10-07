import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ClerkProvider } from "@clerk/react";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const Root = () => publishableKey ? (
  <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
    <App />
  </ClerkProvider>
) : <App />;

createRoot(document.getElementById("root")!).render(<Root />);
