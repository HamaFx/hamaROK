import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
