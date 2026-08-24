import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Deen & Daleel",
  description:
    "Answers about Islam with their evidence — cited Qur'an, hadith, tafsir and fiqh.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Amiri is a naskh face with correct diacritic positioning; a Latin UI
            font renders vocalised Qur'anic text badly. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="h-full antialiased"
        style={{ ["--font-arabic" as string]: "'Amiri', serif" }}
      >
        {children}
      </body>
    </html>
  );
}
