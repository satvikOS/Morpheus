import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morpheus Workstation",
  description:
    "Local-first neural experience research workstation for acquisition, dream ground truth, public neurodata, simulations, model workers, and neuro-spatial reconstruction.",
  applicationName: "Morpheus",
  icons: {
    icon: "/morpheus-logo.png",
    shortcut: "/morpheus-logo.png",
    apple: "/morpheus-logo.png",
  },
  openGraph: {
    title: "Morpheus Workstation",
    description:
      "Neural experience research OS for acquisition, open neuroscience data, simulations, M0–M5 programs, and 3D neurovisualization.",
    images: ["/morpheus-logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#030609",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
