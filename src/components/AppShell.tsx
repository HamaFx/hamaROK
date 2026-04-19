'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, Sparkles } from 'lucide-react';
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


function BrandLockup() {
  return (
    <Link href="/" className="group flex items-center gap-2 min-[390px]:gap-2.5">
      <div className="relative overflow-hidden rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors group-hover:border-[color:var(--stroke-strong)] group-hover:bg-[color:var(--surface-4)] min-[390px]:rounded-2xl min-[390px]:p-2">
        <Image
          src="/hama-logo.svg"
          alt="HamaROK"
          width={112}
          height={28}
          priority
          className="h-6 w-auto min-[390px]:h-7"
          style={{ width: 'auto', height: 'auto' }}
        />
      </div>
      <div className="hidden min-w-0 sm:block">
        <p className="font-heading text-sm font-semibold tracking-wide text-tier-1">
          HamaROK
        </p>
        <p className="text-xs text-tier-3">Player rankings and weekly statboards</p>
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
              'h-11 rounded-full px-4 text-sm text-tier-3 hover:bg-white/5 hover:text-tier-1 transition-all duration-300',
              active && 'bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] text-tier-1 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent),0_0_12px_color-mix(in_oklab,var(--primary)_20%,transparent)]'
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
            'hidden h-11 rounded-full border border-[color:var(--stroke-soft)] bg-white/5 px-4 text-tier-3 hover:bg-white/10 hover:text-tier-1 transition-all duration-300 transform-gpu lg:inline-flex',
            activeTool && 'border-[color:color-mix(in_oklab,var(--primary)_40%,transparent)] bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] text-tier-1 shadow-[0_0_12px_color-mix(in_oklab,var(--primary)_20%,transparent)]'
          )}
        >
          <Menu data-icon="inline-start" />
          Tools
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 border-white/10 glass-panel shadow-2xl text-tier-1">
        <DropdownMenuLabel className="text-tier-3">Operational Pages</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[color:var(--stroke-subtle)]" />
        {TOOL_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild className="rounded-xl px-3 py-3 text-tier-2 focus:bg-[color:var(--surface-4)] focus:text-tier-1">
              <Link href={item.href} className="flex items-start gap-3">
                <span className="mt-0.5 rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-2 text-tier-2">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium text-tier-1">{item.label}</span>
                  <span className="text-xs leading-relaxed text-tier-3">{item.description}</span>
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
      <nav className="fixed inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 grid h-[64px] grid-cols-5 rounded-[24px] glass-panel px-1.5 text-tier-3 shadow-[0_8px_32px_rgba(0,229,255,0.15)] min-[430px]:inset-x-4 min-[430px]:h-[70px] min-[430px]:px-2 lg:hidden">
        {MOBILE_PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex h-full flex-col items-center justify-center gap-1 rounded-[20px] px-1 text-xs font-medium tracking-wide transition-colors min-h-[44px] min-w-[44px]',
                'gap-0.5 rounded-[18px] text-xs min-[430px]:gap-1 min-[430px]:rounded-[20px] min-[430px]:text-xs',
                active ? 'bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] text-tier-1 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent),0_0_12px_color-mix(in_oklab,var(--primary)_20%,transparent)]' : 'text-tier-3'
              )}
            >
              <Icon className="size-3.5 min-[430px]:size-4" />
              <span>{item.mobileLabel ?? item.label}</span>
            </Link>
          );
        })}
        <DrawerTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-full flex-col items-center justify-center gap-0.5 rounded-[18px] px-1 text-xs font-medium tracking-wide text-tier-3 hover:bg-[color:var(--surface-3)] hover:text-tier-1 min-[430px]:gap-1 min-[430px]:rounded-[20px] min-[430px]:text-xs min-h-[44px] min-w-[44px]"
          >
            <Menu className="size-3.5 min-[430px]:size-4" />
            <span>More</span>
          </Button>
        </DrawerTrigger>
      </nav>
      <DrawerContent className="border-white/10 !bg-[#050505]/95 backdrop-blur-3xl shadow-2xl text-tier-1">
        <DrawerHeader>
          <DrawerTitle className="font-heading text-xl text-tier-1">More</DrawerTitle>
          <DrawerDescription className="text-tier-3">
            Compare boards first, then jump into operational tools.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto overscroll-contain px-4 pb-4 max-h-[60svh]">
          <div className="grid gap-3">
            {MOBILE_MORE_NAV.map((item, index) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);
              const isCompare = index === 0;
              return (
                <DrawerClose asChild key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'group flex items-start gap-3 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-4 transition-all hover:bg-white/5 hover:border-white/20',
                      active && 'border-[color:color-mix(in_oklab,var(--primary)_40%,transparent)] bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] text-tier-1 shadow-[0_0_12px_color-mix(in_oklab,var(--primary)_20%,transparent)]'
                    )}
                  >
                    <span
                      className={cn(
                        'rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] p-2.5 text-tier-2 transition-colors',
                        isCompare && !active && 'border-[color:color-mix(in_oklab,var(--rank-gold)_38%,transparent)] bg-[color:color-mix(in_oklab,var(--rank-gold)_16%,transparent)] text-[color:var(--rank-gold)]',
                        active && 'text-[color:var(--primary)] border-[color:var(--primary)]'
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-medium text-tier-1">{item.label}</span>
                      <span className="text-xs leading-relaxed text-tier-3">{item.description}</span>
                    </span>
                  </Link>
                </DrawerClose>
              );
            })}
          </div>
        </div>
        <DrawerFooter className="pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-0">
          <DrawerClose asChild>
            <Button variant="outline" className="border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1">
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--tone-teal)_4%,transparent),transparent_40%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--tone-teal)_3%,transparent),transparent_30%)]" />
      <header className="sticky top-2 sm:top-4 z-30 mx-auto w-[calc(100%-1rem)] max-w-[1600px] rounded-[24px] glass-panel shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 sm:w-[calc(100%-3rem)] lg:top-6">
        <div className="mx-auto flex w-full items-center justify-between gap-2 px-3 py-3 min-[390px]:gap-4 min-[390px]:px-4 min-[390px]:py-3.5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5 min-[390px]:gap-4">
            <BrandLockup />
            <div className="hidden h-10 w-px bg-[color:var(--stroke-subtle)] lg:block" />
            <div className="hidden min-w-0 lg:block">
              <p className="micro-label">Now viewing</p>
              <p className="mt-1 truncate font-heading text-sm text-tier-1">{activeNav.label}</p>
            </div>
          </div>

          <DesktopNav />

          <div className="flex items-center gap-2">
            <Badge className="chip-label hidden rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-1 text-xs text-tier-3 sm:inline-flex">
              <Sparkles className="mr-1 size-3" /> Rankings-first
            </Badge>
            <ToolsMenu />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-col px-3 pb-[calc(6.8rem+env(safe-area-inset-bottom))] pt-4 min-[390px]:px-4 min-[390px]:pb-[calc(7.2rem+env(safe-area-inset-bottom))] min-[390px]:pt-5 sm:px-6 lg:px-8 lg:pb-14 lg:pt-7">
        {weeklySchemaWarning ? (
          <Alert className="mb-6 border-amber-300/22 bg-[color:color-mix(in_oklab,var(--rank-gold)_18%,transparent)] text-amber-50">
            <AlertTitle className="font-heading text-sm">Schema Attention Needed</AlertTitle>
            <AlertDescription className="text-amber-100/80">{weeklySchemaWarning}</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </main>

      <MobileMoreNav />
    </div>
  );
}
