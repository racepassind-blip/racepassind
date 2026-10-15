import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPushWorker } from "@/lib/pushNotifications";

registerPushWorker();
createRoot(document.getElementById("root")!).render(<App />);
