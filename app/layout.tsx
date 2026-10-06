import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://morpheus-three.vercel.app"),
  title: "Morpheus Workstation",
  description:
    "Local-first neural experience research workstation for acquisition, dream ground truth, public neurodata, simulations, model workers, and neuro-spatial reconstruction.",
  applicationName: "Morpheus",
  icons: {
    icon: "/morpheus-symbol.svg",
    shortcut: "/morpheus-symbol.svg",
  },
  openGraph: {
    title: "Morpheus Workstation",
    description:
      "Neural experience research OS for acquisition, open neuroscience data, simulations, M0–M5 programs, and 3D neurovisualization.",
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
