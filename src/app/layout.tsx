import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Manrope, Sora } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';
import { TooltipProvider } from '@/components/ui/tooltip';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${sora.variable} ${manrope.variable} ${geistMono.variable} antialiased`}>
        <TooltipProvider delayDuration={120}>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
