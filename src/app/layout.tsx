import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'HamaROK — Alliance & Player Analytics',
  description:
    'Track Rise of Kingdoms alliance and player performance with weekly analytics, OCR-assisted ingestion, and ranking workflows.',
  keywords:
    'Rise of Kingdoms, RoK, alliance analytics, player analytics, OCR ranking review, weekly tracking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
