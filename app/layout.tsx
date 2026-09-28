import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morpheus Workstation",
  description: "Local-first neural experience research workstation for acquisition, dream ground truth, open neurodata, experiments, and spatial reconstruction.",
  applicationName: "Morpheus",
};

export const viewport: Viewport = {
  themeColor: "#030609",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
