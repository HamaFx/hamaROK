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
  applicationName: 'HamaROK',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HamaROK',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icons/icon-192.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#020308',
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
