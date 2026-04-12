export type WarriorTier = 'War Legend' | 'Elite Warrior' | 'Frontline Fighter' | 'Support Role' | 'Inactive';

export interface SnapshotDelta {
  governorId: string;
  governorName: string;
  killPointsDelta: bigint;
  t4KillsDelta: bigint;
  t5KillsDelta: bigint;
  deadsDelta: bigint;
  powerDelta: bigint;
}

export interface WarriorResult {
  governorId: string;
  governorName: string;
  killScore: number;
  deadScore: number;
  powerBonus: number;
  warriorScore: number;
  tier: WarriorTier;
  rank: number;
}

export interface TierConfig {
  emoji: string;
  color: string;
  label: string;
  bgClass: string;
}

export function calculateWarriorScores(deltas: SnapshotDelta[]): WarriorResult[] {
  if (deltas.length === 0) return [];

  // Step 1: Calculate weighted kill values
  const withWeighted = deltas.map((d) => ({
    ...d,
    weightedKill: Number(d.t4KillsDelta) * 2 + Number(d.t5KillsDelta) * 5,
  }));

  // Step 2: Find max values for normalization
  const maxKill = Math.max(...withWeighted.map((d) => Math.max(d.weightedKill, 0)), 1);
  const maxDead = Math.max(...deltas.map((d) => Math.max(Number(d.deadsDelta), 0)), 1);

  // Step 3: Calculate scores
  const results: WarriorResult[] = withWeighted.map((d) => {
    const killScore = Math.max(0, (d.weightedKill / maxKill) * 100);
    const deadScore = Math.max(0, (Number(d.deadsDelta) / maxDead) * 100);
    const powerBonus = Number(d.powerDelta) < 0 ? 5.0 : 0.0;
    const rawScore = killScore * 0.55 + deadScore * 0.4 + powerBonus;
    const warriorScore = Math.min(Math.round(rawScore * 10) / 10, 100);

    return {
      governorId: d.governorId,
      governorName: d.governorName,
      killScore: Math.round(killScore * 10) / 10,
      deadScore: Math.round(deadScore * 10) / 10,
      powerBonus,
      warriorScore,
      tier: getWarriorTier(warriorScore),
      rank: 0,
    };
  });

  // Step 4: Sort and assign ranks
  results.sort((a, b) => b.warriorScore - a.warriorScore);
  results.forEach((r, i) => (r.rank = i + 1));

  return results;
}

export function getWarriorTier(score: number): WarriorTier {
  if (score >= 90) return 'War Legend';
  if (score >= 70) return 'Elite Warrior';
  if (score >= 50) return 'Frontline Fighter';
  if (score >= 30) return 'Support Role';
  return 'Inactive';
}

export function getTierConfig(tier: WarriorTier): TierConfig {
  const configs: Record<WarriorTier, TierConfig> = {
    'War Legend': { emoji: '🏆', color: '#f59e0b', label: 'War Legend', bgClass: 'tier-war-legend' },
    'Elite Warrior': { emoji: '⚔️', color: '#8b5cf6', label: 'Elite Warrior', bgClass: 'tier-elite' },
    'Frontline Fighter': { emoji: '🛡️', color: '#3b82f6', label: 'Frontline Fighter', bgClass: 'tier-frontline' },
    'Support Role': { emoji: '🏹', color: '#10b981', label: 'Support Role', bgClass: 'tier-support' },
    Inactive: { emoji: '💤', color: '#64748b', label: 'Inactive', bgClass: 'tier-inactive' },
  };
  return configs[tier];
}
