'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Cog,
  Crosshair,
  FileBarChart2,
  FlaskConical,
  Home,
  ImageUp,
  Radar,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  Workflow,
  X,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  group: 'core' | 'analysis' | 'ops';
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Home, group: 'core' },
  { href: '/upload', label: 'Upload', icon: ImageUp, group: 'core' },
  { href: '/events', label: 'Events', icon: CalendarDays, group: 'core' },
  { href: '/governors', label: 'Governors', icon: Users, group: 'core' },
  { href: '/compare', label: 'Compare', icon: Workflow, group: 'analysis' },
  { href: '/insights', label: 'Insights', icon: Radar, group: 'analysis' },
  { href: '/rankings', label: 'Rankings', icon: Trophy, group: 'analysis' },
  { href: '/review', label: 'OCR Review', icon: FlaskConical, group: 'ops' },
  { href: '/rankings/review', label: 'Rank Review', icon: ShieldCheck, group: 'ops' },
  { href: '/calibration', label: 'Calibration', icon: Crosshair, group: 'ops' },
  { href: '/settings', label: 'Settings', icon: Cog, group: 'ops' },
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
  const [workspaceLabel, setWorkspaceLabel] = useState('No workspace');
  const [accessLabel, setAccessLabel] = useState('No access token');

  useEffect(() => {
    const syncAccessContext = () => {
      const workspaceId = localStorage.getItem('workspaceId') || '';
      const token = localStorage.getItem('workspaceToken') || '';
      setWorkspaceLabel(workspaceId ? `Workspace ${workspaceId.slice(0, 8)}...` : 'No workspace');
      setAccessLabel(token ? 'Secure link active' : 'No access token');
    };

    syncAccessContext();
    window.addEventListener('storage', syncAccessContext);
    return () => window.removeEventListener('storage', syncAccessContext);
  }, []);

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

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary">
        <div className="app-brand-wrap">
          <Link href="/" className="app-brand">
            <Image src="/hana-logo.svg" alt="Hana logo" className="app-brand-logo" width={176} height={44} priority />
          </Link>
          <span className="app-badge">HANA OPS</span>
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
              <Image src="/hana-logo.svg" alt="Hana logo" className="app-header-logo" width={176} height={44} priority />
            </Link>
            <div className="app-topbar-heading">
              <strong>{activeNav.label}</strong>
              <span>{groupLabel(activeNav.group)}</span>
            </div>
          </div>

          <div className="app-topbar-context">
            <div className="app-context-chip">
              <span className="label">Workspace</span>
              <span className="value">{workspaceLabel}</span>
            </div>
            <div className="app-context-chip muted">
              <span className="label">Access</span>
              <span className="value">{accessLabel}</span>
            </div>
            <div className="app-topbar-right">
              <button className="icon-btn" type="button" aria-label="Search">
                <Search size={16} />
              </button>
              <Link className="icon-btn" href="/insights" aria-label="Reports">
                <FileBarChart2 size={16} />
              </Link>
              <Link className="icon-btn" href="/settings" aria-label="Settings">
                <Cog size={16} />
              </Link>
            </div>
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
            <h3>More Sections</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMobileMoreOpen(false)}
              aria-label="Close"
            >
              <X size={14} /> Close
            </button>
          </div>
          <div className="app-mobile-sheet-list">
            {mobileMoreItems.map((item) => {
              const Icon = item.icon;
              const active = matchPath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`app-mobile-sheet-link ${active ? 'active' : ''}`}
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <Icon size={16} strokeWidth={2.1} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
