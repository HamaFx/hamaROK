import type { ReactNode } from 'react';

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
}
