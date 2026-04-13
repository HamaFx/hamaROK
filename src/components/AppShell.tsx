'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
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
  LayoutGrid,
  Radar,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  Workflow,
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

  const workspaceIdLabel =
    typeof window === 'undefined'
      ? 'No workspace'
      : (() => {
          const workspaceId = localStorage.getItem('workspaceId') || '';
          return workspaceId ? `Workspace ${workspaceId.slice(0, 8)}...` : 'No workspace';
        })();

  const workspaceTokenLabel =
    typeof window === 'undefined'
      ? 'No access token'
      : (localStorage.getItem('workspaceToken') || '')
          ? 'Scoped link active'
          : 'No access token';

  const grouped = useMemo(() => {
    return {
      core: NAV_ITEMS.filter((item) => item.group === 'core'),
      analysis: NAV_ITEMS.filter((item) => item.group === 'analysis'),
      ops: NAV_ITEMS.filter((item) => item.group === 'ops'),
    };
  }, []);

  const mobilePrimaryItems = NAV_ITEMS.filter((item) => MOBILE_PRIMARY.includes(item.href));
  const mobileMoreItems = NAV_ITEMS.filter((item) => !MOBILE_PRIMARY.includes(item.href));

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary">
        <div className="app-brand-wrap">
          <Link href="/" className="app-brand">
            <span className="app-brand-mark" aria-hidden>
              <LayoutGrid size={18} strokeWidth={2.2} />
            </span>
            <span>
              <strong>RoK Command Center</strong>
              <small>v2 Tactical Pro</small>
            </span>
          </Link>
          <span className="app-badge">LIVE OPS</span>
        </div>

        <div className="app-sidebar-scroll">
          <NavSection title="Core" items={grouped.core} pathname={pathname} />
          <NavSection title="Analytics" items={grouped.analysis} pathname={pathname} />
          <NavSection title="Operations" items={grouped.ops} pathname={pathname} />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <div className="app-context-chip">
              <span className="label">Workspace</span>
              <span className="value">{workspaceIdLabel}</span>
            </div>
            <div className="app-context-chip muted">
              <span className="label">Access</span>
              <span className="value">{workspaceTokenLabel}</span>
            </div>
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
        </header>

        <div className="app-content">{children}</div>
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

      {mobileMoreOpen ? (
        <div className="app-mobile-sheet" id="mobile-more-sheet">
          <div className="app-mobile-sheet-inner">
            <div className="app-mobile-sheet-head">
              <h3>More Sections</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMobileMoreOpen(false)}>
                Close
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
        </div>
      ) : null}
    </div>
  );
}
