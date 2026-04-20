import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  CalendarDays,
  ChevronRight,
  Cog,
  Crosshair,
  FlaskConical,
  Home,
  ImageUp,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';

export type AppNavGroup = 'primary' | 'tools';

export interface AppNavItem {
  href: string;
  label: string;
  mobileLabel?: string;
  description: string;
  icon: LucideIcon;
  group: AppNavGroup;
}

export const PRIMARY_NAV_ITEMS: AppNavItem[] = [
  {
    href: '/',
    label: 'Home',
    description: 'Weekly boards, movers, and featured player spotlights.',
    icon: Home,
    group: 'primary',
  },
  {
    href: '/rankings',
    label: 'Rankings',
    description: 'Canonical leaderboards across power, contribution, fort, and kill metrics.',
    icon: Trophy,
    group: 'primary',
  },
  {
    href: '/governors',
    label: 'Players',
    mobileLabel: 'Players',
    description: 'Player directory, spotlight drilldowns, and progression history.',
    icon: Users,
    group: 'primary',
  },
];

export const TOOL_NAV_ITEMS: AppNavItem[] = [
  {
    href: '/assistant',
    label: 'Assistant',
    description: 'Chat with screenshots, review plans, and confirm workspace actions.',
    icon: Bot,
    group: 'tools',
  },
  {
    href: '/upload',
    label: 'Upload',
    description: 'Queue screenshots and OCR jobs for new weekly data.',
    icon: ImageUp,
    group: 'tools',
  },
  {
    href: '/events',
    label: 'Events',
    description: 'Manage event windows, snapshots, and timeline anchors.',
    icon: CalendarDays,
    group: 'tools',
  },
  {
    href: '/review',
    label: 'OCR Review',
    description: 'Validate extracted profile rows before they hit the boards.',
    icon: FlaskConical,
    group: 'tools',
  },
  {
    href: '/rankings/review',
    label: 'Rank Review',
    description: 'Resolve identity matches and ranking-board conflicts.',
    icon: ShieldCheck,
    group: 'tools',
  },
  {
    href: '/calibration',
    label: 'Calibration',
    description: 'Run live server-side Mistral extraction diagnostics.',
    icon: Crosshair,
    group: 'tools',
  },
  {
    href: '/settings',
    label: 'Settings',
    description: 'Configure scoring, standards, integrations, and workspace defaults.',
    icon: Cog,
    group: 'tools',
  },
];

export const MOBILE_PRIMARY_NAV = PRIMARY_NAV_ITEMS;
export const MOBILE_MORE_NAV = TOOL_NAV_ITEMS;

export function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getActiveNav(pathname: string) {
  return [...PRIMARY_NAV_ITEMS, ...TOOL_NAV_ITEMS].find((item) => isActivePath(pathname, item.href)) ?? PRIMARY_NAV_ITEMS[0];
}

export const TOOL_TRIGGER = {
  label: 'Tools',
  description: 'Operational pages for upload, review, setup, and maintenance.',
  icon: ChevronRight,
};
