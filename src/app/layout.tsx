import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';
import { TooltipProvider } from '@/components/ui/tooltip';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'HamaROK — Player Rankings and Weekly Statboards',
  description:
    'Explore Rise of Kingdoms player rankings, weekly statboards, event comparisons, and spotlight drilldowns from OCR-powered alliance data.',
  keywords:
    'Rise of Kingdoms, RoK rankings, player leaderboards, weekly statboards, OCR analytics, event comparison',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${outfit.variable} ${plusJakartaSans.variable} ${geistMono.variable} antialiased`}>
        <TooltipProvider delayDuration={120}>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
