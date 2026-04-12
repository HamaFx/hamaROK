export type WarriorTier = 'War Legend' | 'Elite Warrior' | 'Frontline Fighter' | 'Support Role' | 'Inactive';

export interface DkpConfig {
  t4Weight: number;
  t5Weight: number;
  deadWeight: number;
  kpPerPowerRatio: number;
  deadPerPowerRatio: number;
}

export interface SnapshotDelta {
  governorId: string;
  governorName: string;
  startPower: bigint;
  killPointsDelta: bigint;
  t4KillsDelta: bigint;
  t5KillsDelta: bigint;
  deadsDelta: bigint;
  powerDelta: bigint;
}

export interface WarriorResult {
  governorId: string;
  governorName: string;
  expectedKp: number;
  expectedDeads: number;
  expectedDkp: number;
  actualDkp: number;
  kdRatio: number;
  warriorScore: number;
  isDeadweight: boolean;
  tier: WarriorTier;
  rank: number;
}

export interface TierConfig {
  emoji: string;
  color: string;
  label: string;
  bgClass: string;
}

export function calculateAdvancedDkp(deltas: SnapshotDelta[], config: DkpConfig): WarriorResult[] {
  if (deltas.length === 0) return [];

  const results: WarriorResult[] = deltas.map((d) => {
    // 1. Calculate Expected Targets based on Start Power
    const startPowerMillions = Number(d.startPower) / 1000000;
    const expectedKp = startPowerMillions * config.kpPerPowerRatio * 1000000;
    const expectedDeads = startPowerMillions * config.deadPerPowerRatio * 1000000;
    const expectedDkp = expectedKp + expectedDeads * config.deadWeight;
    
    // 2. Calculate Actual DKP Contribution Match
    const t4KillsDelta = Number(d.t4KillsDelta);
    const t5KillsDelta = Number(d.t5KillsDelta);
    const deadsDelta = Number(d.deadsDelta);
    
    const actualDkp =
      t4KillsDelta * config.t4Weight +
      t5KillsDelta * config.t5Weight +
      deadsDelta * config.deadWeight;
    
    // 3. Warrior Score (Percent of Expectation Met)
    let percentMet = 0;
    if (expectedDkp > 0) {
       percentMet = (actualDkp / expectedDkp) * 100;
    } else {
       percentMet = actualDkp > 0 ? 100 : 0;
    }

    // Cap score at 120 so overperformers don't break charts
    const warriorScore = Math.min(Math.round(percentMet * 10) / 10, 120);

    // 4. K/D Ratio
    const totalKills = t4KillsDelta + t5KillsDelta;
    const kdRatio = deadsDelta > 0 ? (totalKills / deadsDelta) : totalKills;

    // 5. Deadweight Flag: Dropped > 2M power with < 100,000 DKP (Meaning getting zeroed while offline)
    const isDeadweight = (Number(d.powerDelta) < -2000000) && (actualDkp < 100000);

    return {
      governorId: d.governorId,
      governorName: d.governorName,
      expectedKp: Math.round(expectedKp),
      expectedDeads: Math.round(expectedDeads),
      expectedDkp: Math.round(expectedDkp),
      actualDkp: Math.round(actualDkp),
      kdRatio: Math.round(kdRatio * 100) / 100,
      warriorScore,
      isDeadweight,
      tier: isDeadweight ? 'Inactive' : getWarriorTier(warriorScore),
      rank: 0,
    };
  });

  // Sort and assign ranks
  results.sort((a, b) => b.warriorScore - a.warriorScore);
  results.forEach((r, i) => (r.rank = i + 1));

  return results;
}

export function getWarriorTier(score: number): WarriorTier {
  if (score >= 100) return 'War Legend';
  if (score >= 80) return 'Elite Warrior';
  if (score >= 50) return 'Frontline Fighter';
  if (score >= 20) return 'Support Role';
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
