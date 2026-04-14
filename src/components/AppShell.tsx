'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Cog,
  Crosshair,
  FlaskConical,
  Home,
  ImageUp,
  Radar,
  ShieldCheck,
  Trophy,
  Users,
  Workflow,
  X,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  group: 'core' | 'analysis' | 'ops';
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', hint: 'Command center and recent activity', icon: Home, group: 'core' },
  { href: '/upload', label: 'Upload', hint: 'Queue screenshots for OCR processing', icon: ImageUp, group: 'core' },
  { href: '/events', label: 'Events', hint: 'Manage scan windows and timelines', icon: CalendarDays, group: 'core' },
  { href: '/governors', label: 'Governors', hint: 'Search member records and history', icon: Users, group: 'core' },
  { href: '/compare', label: 'Compare', hint: 'Compare two events side by side', icon: Workflow, group: 'analysis' },
  { href: '/insights', label: 'Insights', hint: 'Charts and contribution trends', icon: Radar, group: 'analysis' },
  { href: '/rankings', label: 'Rankings', hint: 'Canonical leaderboards and ties', icon: Trophy, group: 'analysis' },
  { href: '/review', label: 'OCR Review', hint: 'Validate profile extractions', icon: FlaskConical, group: 'ops' },
  { href: '/rankings/review', label: 'Rank Review', hint: 'Resolve ranking identity matches', icon: ShieldCheck, group: 'ops' },
  { href: '/calibration', label: 'Calibration', hint: 'Tune OCR capture profiles', icon: Crosshair, group: 'ops' },
  { href: '/settings', label: 'Settings', hint: 'Workspace and automation controls', icon: Cog, group: 'ops' },
];

const MOBILE_PRIMARY = ['/', '/upload', '/rankings', '/insights'];

function matchPath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupLabel(group: NavItem['group']) {
  if (group === 'core') return 'Core';
  if (group === 'analysis') return 'Analytics';
  return 'Operations';
}

function NavSection({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <section className="app-nav-section">
      <p className="app-nav-title">{title}</p>
      <ul className="app-nav-list">
        {items.map((item) => {
          const active = matchPath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`app-nav-link ${active ? 'active' : ''}`}
                onClick={onNavigate}
              >
                <Icon size={16} strokeWidth={2} />
                <span>{item.label}</span>
                <ChevronRight size={14} className="app-nav-chevron" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const grouped = useMemo(() => {
    return {
      core: NAV_ITEMS.filter((item) => item.group === 'core'),
      analysis: NAV_ITEMS.filter((item) => item.group === 'analysis'),
      ops: NAV_ITEMS.filter((item) => item.group === 'ops'),
    };
  }, []);

  const activeNav = useMemo(
    () => NAV_ITEMS.find((item) => matchPath(pathname, item.href)) || NAV_ITEMS[0],
    [pathname]
  );

  const mobilePrimaryItems = NAV_ITEMS.filter((item) => MOBILE_PRIMARY.includes(item.href));
  const mobileMoreItems = NAV_ITEMS.filter((item) => !MOBILE_PRIMARY.includes(item.href));
  const mobileQuickItems = mobileMoreItems.filter((item) => ['/events', '/review', '/settings'].includes(item.href));
  const mobileMoreGroups: Array<NavItem['group']> = ['core', 'analysis', 'ops'];

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary">
        <div className="app-brand-wrap">
          <Link href="/" className="app-brand">
            <Image src="/hama-logo.svg" alt="Hama logo" className="app-brand-logo" width={176} height={44} priority />
          </Link>
          <span className="app-badge">HAMA OPS</span>
        </div>

        <div className="app-sidebar-scroll">
          <NavSection title="Core" items={grouped.core} pathname={pathname} />
          <NavSection title="Analytics" items={grouped.analysis} pathname={pathname} />
          <NavSection title="Operations" items={grouped.ops} pathname={pathname} />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-main">
            <Link href="/" className="app-header-brand">
              <Image src="/hama-logo.svg" alt="Hama logo" className="app-header-logo" width={176} height={44} priority />
            </Link>
            <div className="app-topbar-heading">
              <strong>{activeNav.label}</strong>
              <span>{groupLabel(activeNav.group)}</span>
            </div>
          </div>
          <div className="app-topbar-context">
            <Link href="/settings" className="app-context-chip app-settings-chip">
              <Cog size={14} />
              <span className="value">Settings</span>
            </Link>
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      <nav className="app-mobile-nav" aria-label="Mobile">
        {mobilePrimaryItems.map((item) => {
          const Icon = item.icon;
          const active = matchPath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`app-mobile-link ${active ? 'active' : ''}`}
              onClick={() => setMobileMoreOpen(false)}
            >
              <Icon size={16} strokeWidth={2.2} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className={`app-mobile-link ${mobileMoreOpen ? 'active' : ''}`}
          onClick={() => setMobileMoreOpen((prev) => !prev)}
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-sheet"
        >
          <BarChart3 size={16} strokeWidth={2.2} />
          <span>More</span>
        </button>
      </nav>

      {mobileMoreOpen ? <button className="app-mobile-backdrop" onClick={() => setMobileMoreOpen(false)} aria-label="Close menu" /> : null}

      <aside className={`app-mobile-sheet ${mobileMoreOpen ? 'open' : ''}`} id="mobile-more-sheet">
        <div className="app-mobile-sheet-inner">
          <div className="app-mobile-sheet-head">
            <div>
              <h3>More</h3>
              <p className="app-mobile-sheet-sub">Secondary tools and workflows</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMobileMoreOpen(false)}
              aria-label="Close"
            >
              <X size={14} /> Close
            </button>
          </div>

          <div className="app-mobile-quick-strip">
            {mobileQuickItems.map((item) => {
              const Icon = item.icon;
              const active = matchPath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`app-mobile-quick-link ${active ? 'active' : ''}`}
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <Icon size={14} strokeWidth={2.2} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="app-mobile-sheet-sections">
            {mobileMoreGroups.map((group) => {
              const groupItems = mobileMoreItems.filter((item) => item.group === group);
              if (!groupItems.length) return null;
              return (
                <section key={group} className="app-mobile-sheet-section">
                  <p className="app-mobile-sheet-section-title">{groupLabel(group)}</p>
                  <div className="app-mobile-sheet-list">
                    {groupItems.map((item) => {
                      const Icon = item.icon;
                      const active = matchPath(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`app-mobile-sheet-link ${active ? 'active' : ''}`}
                          onClick={() => setMobileMoreOpen(false)}
                        >
                          <span className="app-mobile-sheet-link-icon">
                            <Icon size={16} strokeWidth={2.1} />
                          </span>
                          <span className="app-mobile-sheet-link-copy">
                            <strong>{item.label}</strong>
                            <small>{item.hint}</small>
                          </span>
                          <ChevronRight size={14} className="app-mobile-sheet-link-chevron" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
