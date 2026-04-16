import type { ReactNode } from 'react';
import type { AppNavItem } from './navigation';

export type LeaderboardMetricKey =
  | 'power'
  | 'contribution_points'
  | 'fort_destroying'
  | 'kill_points'
  | 'power_growth'
  | 'kill_points_growth';

export interface PlayerSpotlightModel {
  id: string;
  name: string;
  governorId: string | null;
  allianceLabel: string | null;
  allianceTag: string | null;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel?: string;
  secondaryValue?: string;
  note?: string;
}

export interface PlayerProfileMetric {
  label: string;
  value: string | null | undefined;
}

export interface PlayerProfileViewModel {
  id: string;
  name: string;
  governorId: string | null;
  allianceLabel: string | null;
  allianceTag: string | null;
  latestPower: string;
  snapshotCount: number;
  currentStatus: string;
  metrics: PlayerProfileMetric[];
}

export interface SessionGateProps {
  ready: boolean;
  loading: boolean;
  error: string | null;
  children: ReactNode;
  loadingLabel?: string;
  notReadyLabel?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export type PageViewState = 'loading' | 'ready' | 'error' | 'empty';

export type MobileDataMode = 'cards' | 'table';

export type UiDensity = 'comfortable' | 'balanced-compact' | 'compact';

export type CompactControlDrawerId = 'rankingsFilters' | 'playersPerformance' | 'statsFilters';

export type CompactControlDrawerState = Record<CompactControlDrawerId, boolean>;

export interface SurfaceDensityProps {
  density?: UiDensity;
  compact?: boolean;
}

export interface NavGroups {
  primary: AppNavItem[];
  tools: AppNavItem[];
}
