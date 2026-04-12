import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'RoK Command Center — Alliance Management Tool',
  description: 'Track Rise of Kingdoms alliance performance. Analyze governor stats via screenshot OCR, compare KvK snapshots, and rank warriors.',
  keywords: 'Rise of Kingdoms, RoK, alliance, KvK, governor, analytics, OCR',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
