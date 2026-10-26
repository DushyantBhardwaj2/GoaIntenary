import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import "@/components/ledger.css";
import { SessionProvider } from "@/components/session";

export const metadata: Metadata = {
  title: "Goa, together — your private trip companion",
  description: "A little space for your people and your next Goa getaway. Private trips, thoughtful company."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><SessionProvider>{children}</SessionProvider></body></html>;
}
