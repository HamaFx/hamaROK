'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  getActiveNav,
  isActivePath,
  MOBILE_MORE_NAV,
  MOBILE_PRIMARY_NAV,
  PRIMARY_NAV_ITEMS,
  TOOL_NAV_ITEMS,
} from '@/features/shared/navigation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';

function BrandLockup() {
  return (
    <Link href="/" className="group flex items-center gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-white/5 p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors group-hover:border-white/20 group-hover:bg-white/8">
        <Image
          src="/hama-logo.svg"
          alt="HamaROK"
          width={112}
          height={28}
          priority
          className="h-7 w-auto"
          style={{ width: 'auto', height: 'auto' }}
        />
      </div>
      <div className="hidden min-w-0 sm:block">
        <p className="font-[family-name:var(--font-sora)] text-sm font-semibold tracking-wide text-white">
          HamaROK
        </p>
        <p className="text-xs text-white/55">Player rankings and weekly statboards</p>
      </div>
    </Link>
  );
}

function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {PRIMARY_NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        return (
          <Button
            key={item.href}
            asChild
            variant="ghost"
            className={cn(
              'h-11 rounded-full px-4 text-sm text-white/68 hover:bg-white/8 hover:text-white',
              active && 'bg-[linear-gradient(135deg,rgba(98,164,255,0.24),rgba(255,255,255,0.05))] text-white shadow-[inset_0_0_0_1px_rgba(141,193,255,0.28)]'
            )}
          >
            <Link href={item.href}>
              <Icon data-icon="inline-start" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

function ToolsMenu() {
  const pathname = usePathname();
  const activeTool = TOOL_NAV_ITEMS.find((item) => isActivePath(pathname, item.href));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'hidden h-11 rounded-full border border-white/10 bg-white/4 px-4 text-white/72 hover:bg-white/8 hover:text-white lg:inline-flex',
            activeTool && 'border-[rgba(141,193,255,0.3)] bg-[rgba(98,164,255,0.16)] text-white'
          )}
        >
          <Menu data-icon="inline-start" />
          Tools
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 border-white/10 bg-[rgba(9,12,20,0.96)] text-white backdrop-blur-xl">
        <DropdownMenuLabel className="text-white/65">Operational Pages</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/8" />
        {TOOL_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild className="rounded-xl px-3 py-3 text-white/80 focus:bg-white/8 focus:text-white">
              <Link href={item.href} className="flex items-start gap-3">
                <span className="mt-0.5 rounded-xl border border-white/10 bg-white/6 p-2 text-white/80">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium text-white">{item.label}</span>
                  <span className="text-xs leading-relaxed text-white/55">{item.description}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileMoreNav() {
  const pathname = usePathname();

  return (
    <Drawer>
      <nav className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 grid h-[74px] grid-cols-5 rounded-[28px] border border-white/10 bg-[rgba(8,10,16,0.92)] px-2 text-white/68 shadow-[0_16px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl lg:hidden">
        {MOBILE_PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex h-full flex-col items-center justify-center gap-1 rounded-[20px] px-1 text-[11px] font-medium tracking-wide transition-colors',
                active ? 'bg-[rgba(98,164,255,0.18)] text-white' : 'text-white/58'
              )}
            >
              <Icon className="size-4" />
              <span>{item.mobileLabel ?? item.label}</span>
            </Link>
          );
        })}
        <DrawerTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-full flex-col items-center justify-center gap-1 rounded-[20px] px-1 text-[11px] font-medium tracking-wide text-white/68 hover:bg-white/6 hover:text-white"
          >
            <Menu className="size-4" />
            <span>More</span>
          </Button>
        </DrawerTrigger>
      </nav>
      <DrawerContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
        <DrawerHeader>
          <DrawerTitle className="font-[family-name:var(--font-sora)] text-xl text-white">More</DrawerTitle>
          <DrawerDescription className="text-white/55">
            Compare boards first, then jump into operational tools.
          </DrawerDescription>
        </DrawerHeader>
        <ScrollArea className="max-h-[60svh] px-4">
          <div className="grid gap-3 pb-4">
            {MOBILE_MORE_NAV.map((item, index) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);
              const isCompare = index === 0;
              return (
                <DrawerClose asChild key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'group flex items-start gap-3 rounded-2xl border border-white/10 bg-white/4 p-4 transition-colors hover:bg-white/7',
                      active && 'border-[rgba(141,193,255,0.28)] bg-[rgba(98,164,255,0.12)]'
                    )}
                  >
                    <span
                      className={cn(
                        'rounded-2xl border border-white/10 bg-white/6 p-2.5 text-white/78',
                        isCompare && 'border-[rgba(255,215,132,0.28)] bg-[rgba(255,200,91,0.12)] text-[#ffd67b]'
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-medium text-white">{item.label}</span>
                      <span className="text-xs leading-relaxed text-white/55">{item.description}</span>
                    </span>
                  </Link>
                </DrawerClose>
              );
            })}
          </div>
        </ScrollArea>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline" className="border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white">
              Close
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeNav = getActiveNav(pathname);
  const [weeklySchemaWarning, setWeeklySchemaWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch('/api/healthz', { cache: 'no-store' });
        const payload = await res.json();
        const warnings: unknown[] = Array.isArray(payload?.warnings) ? payload.warnings : [];
        const warning = warnings.find((entry) =>
          String(entry).toLowerCase().includes('weekly schema migration required')
        );
        if (!cancelled) {
          setWeeklySchemaWarning(warning ? String(warning) : null);
        }
      } catch {
        if (!cancelled) setWeeklySchemaWarning(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(84,137,255,0.18),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(108,214,255,0.12),_transparent_24%)]" />
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="sticky top-0 z-30 border-b border-white/8 bg-[rgba(7,9,15,0.76)] backdrop-blur-xl"
      >
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <BrandLockup />
            <div className="hidden h-10 w-px bg-white/8 lg:block" />
            <div className="hidden min-w-0 lg:block">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/38">Now Viewing</p>
              <p className="mt-1 truncate font-[family-name:var(--font-sora)] text-sm text-white">{activeNav.label}</p>
            </div>
          </div>

          <DesktopNav />

          <div className="flex items-center gap-2">
            <Badge className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60 sm:inline-flex">
              <Sparkles className="mr-1 size-3" /> Rankings-first
            </Badge>
            <ToolsMenu />
          </div>
        </div>
      </motion.header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
        {weeklySchemaWarning ? (
          <Alert className="mb-6 border-amber-300/16 bg-[rgba(120,78,9,0.18)] text-amber-50">
            <AlertTitle className="font-[family-name:var(--font-sora)] text-sm">Schema Attention Needed</AlertTitle>
            <AlertDescription className="text-amber-100/80">{weeklySchemaWarning}</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </main>

      <MobileMoreNav />
    </div>
  );
}
