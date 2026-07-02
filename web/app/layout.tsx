import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLI for sume.com",
  description: "Install the Sume CLI.",
  icons: {
    icon: [
      {
        rel: "icon",
        type: "image/x-icon",
        url: "/favicon.ico",
      },
      {
        rel: "shortcut icon",
        url: "/favicon.ico",
      },
    ],
  },
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
