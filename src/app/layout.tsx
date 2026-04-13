import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'RoK Command Center v2 — Tactical Operations Dashboard',
  description:
    'Track Rise of Kingdoms alliance performance with ranking analytics, OCR-assisted ingestion, and deterministic comparison workflows.',
  keywords:
    'Rise of Kingdoms, RoK, alliance analytics, ranking review, OCR command center, KvK intelligence',
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
