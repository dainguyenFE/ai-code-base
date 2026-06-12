import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  description: "Visual code trace explorer",
  title: "AI Trace Studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
