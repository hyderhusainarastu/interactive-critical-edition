import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_NAME } from "@/lib/brand";
import { PreferenceBootstrap } from "@/components/app/PreferenceBootstrap";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: SITE_NAME,
  description:
    "A text is never alone. Upload a difficult scholarly work and get a traceable critical edition around it — resolved citations, passage-anchored annotations, a unified Library, dependency-ordered reading routes, an explorable knowledge graph, and answers grounded in your own library.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head><PreferenceBootstrap /></head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
