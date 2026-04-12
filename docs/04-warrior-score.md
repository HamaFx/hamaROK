# Warrior Score — The Performance Metric

## Philosophy

In Rise of Kingdoms, there's a fundamental truth about KvK participation:

> **Dying is more valuable than killing.**

Why? Because:
- Any player can rally from safety and get kills
- But only players who **send their marches to the front line** will take deaths
- Dead troops = you were physically fighting, not hiding behind flags
- Power loss = you sacrificed your account strength for the kingdom

The Warrior Score captures this by **heavily weighting deaths** and giving a bonus for power loss.

---

## The Formula

### Raw Components (from Delta between two snapshots)

```
Kill Delta    = Snapshot B Kill Points - Snapshot A Kill Points
T4 Kill Delta = Snapshot B T4 Kills - Snapshot A T4 Kills
T5 Kill Delta = Snapshot B T5 Kills - Snapshot A T5 Kills
Dead Delta    = Snapshot B Deads - Snapshot A Deads
Power Delta   = Snapshot B Power - Snapshot A Power
```

### Weighted Kill Score

T5 kills are exponentially harder to achieve and more impactful:

```
Weighted Kill Value = (T4 Kill Delta × 2) + (T5 Kill Delta × 5)
```

| Kill Type | Weight | Rationale                               |
|-----------|--------|-----------------------------------------|
| T4 Kills  | ×2     | Standard high-tier kills                |
| T5 Kills  | ×5     | Much harder, requires top-tier army     |

### Normalization (Per-Event Scaling)

To make scores comparable across events with different activity levels, we normalize against the **maximum value in the event**:

```
Kill Score = (Weighted Kill Value / Max Weighted Kill Value in Event) × 100
Dead Score = (Dead Delta / Max Dead Delta in Event) × 100
```

This gives each governor a score from 0.0 to 100.0 for each component.

### Power Loss Bonus

A governor who **lost power** during KvK was fighting on the front lines:

```
Power Bonus = Power Delta < 0 ? 5.0 : 0.0
```

This is a flat 5-point bonus — enough to differentiate fighters from farmers among players with similar kill/dead scores.

### Final Warrior Score

```
Warrior Score = (Kill Score × 0.55) + (Dead Score × 0.40) + Power Bonus
```

| Component    | Weight | Rationale                                   |
|--------------|--------|---------------------------------------------|
| Kill Score   | 55%    | Primary combat metric                       |
| Dead Score   | 40%    | Shows front-line participation              |
| Power Bonus  | 5 pts  | Rewards sacrifice over safe play            |

**Maximum possible score: 105.0** (capped at 100 for display)

---

## Ranking Tiers

| Score  | Tier              | Badge  | Color   | Description                    |
|--------|--------------------|--------|---------|--------------------------------|
| 90-100 | 🏆 War Legend      | Gold   | #f59e0b | Top performers, led the charge |
| 70-89  | ⚔️ Elite Warrior   | Purple | #8b5cf6 | Major contributors             |
| 50-69  | 🛡️ Frontline Fighter| Blue   | #3b82f6 | Solid participation            |
| 30-49  | 🏹 Support Role    | Green  | #10b981 | Some contribution              |
| 0-29   | 💤 Inactive        | Gray   | #64748b | Little to no participation     |

---

## Calculation Example

### Raw Data

| Governor     | Kill Pts Δ | T4 Kills Δ | T5 Kills Δ | Dead Δ    | Power Δ      |
|--------------|------------|------------|------------|-----------|--------------|
| HamaWarlord  | 70M        | 20M        | 8M         | 30M       | -3M          |
| DragonSlayer | 80M        | 20M        | 15M        | 30M       | +5M          |
| SilentBlade  | 10M        | 5M         | 1M         | 5M        | +10M         |

### Step 1: Weighted Kill Values

```
HamaWarlord:  (20M × 2) + (8M × 5)  = 40M + 40M = 80M
DragonSlayer: (20M × 2) + (15M × 5) = 40M + 75M = 115M  ← MAX
SilentBlade:  (5M × 2)  + (1M × 5)  = 10M + 5M  = 15M
```

### Step 2: Normalize Kill Scores (max = 115M)

```
HamaWarlord:  (80M / 115M) × 100  = 69.6
DragonSlayer: (115M / 115M) × 100 = 100.0
SilentBlade:  (15M / 115M) × 100  = 13.0
```

### Step 3: Normalize Dead Scores (max = 30M)

```
HamaWarlord:  (30M / 30M) × 100 = 100.0
DragonSlayer: (30M / 30M) × 100 = 100.0
SilentBlade:  (5M / 30M) × 100  = 16.7
```

### Step 4: Power Bonus

```
HamaWarlord:  Power Δ = -3M  → Bonus = 5.0
DragonSlayer: Power Δ = +5M  → Bonus = 0.0
SilentBlade:  Power Δ = +10M → Bonus = 0.0
```

### Step 5: Final Warrior Score

```
HamaWarlord:  (69.6 × 0.55) + (100.0 × 0.40) + 5.0 = 38.3 + 40.0 + 5.0 = 83.3 → ⚔️ Elite Warrior
DragonSlayer: (100.0 × 0.55) + (100.0 × 0.40) + 0.0 = 55.0 + 40.0 + 0.0 = 95.0 → 🏆 War Legend
SilentBlade:  (13.0 × 0.55) + (16.7 × 0.40) + 0.0  = 7.2 + 6.7 + 0.0  = 13.9 → 💤 Inactive
```

### Final Rankings

| Rank | Governor     | Warrior Score | Tier              |
|------|-------------|---------------|-------------------|
| 1    | DragonSlayer | 95.0          | 🏆 War Legend     |
| 2    | HamaWarlord  | 83.3          | ⚔️ Elite Warrior  |
| 3    | SilentBlade  | 13.9          | 💤 Inactive       |

**Key Insight**: HamaWarlord ranked 2nd despite lower kill numbers because of equal deaths and power loss — the formula correctly rewards front-line fighting.

---

## Implementation

```typescript
// src/lib/warrior-score.ts

interface SnapshotDelta {
  governorId: string;
  governorName: string;
  killPointsDelta: bigint;
  t4KillsDelta: bigint;
  t5KillsDelta: bigint;
  deadsDelta: bigint;
  powerDelta: bigint;
}

interface WarriorResult {
  governorId: string;
  governorName: string;
  killScore: number;
  deadScore: number;
  powerBonus: number;
  warriorScore: number;
  tier: WarriorTier;
  rank: number;
}

type WarriorTier = 'War Legend' | 'Elite Warrior' | 'Frontline Fighter' | 'Support Role' | 'Inactive';

function calculateWarriorScores(deltas: SnapshotDelta[]): WarriorResult[] {
  // Step 1: Calculate weighted kill values
  const weightedKills = deltas.map(d => ({
    ...d,
    weightedKill: Number(d.t4KillsDelta) * 2 + Number(d.t5KillsDelta) * 5
  }));

  // Step 2: Find max values for normalization
  const maxKill = Math.max(...weightedKills.map(d => d.weightedKill), 1);
  const maxDead = Math.max(...deltas.map(d => Number(d.deadsDelta)), 1);

  // Step 3: Calculate scores
  const results = weightedKills.map(d => {
    const killScore = (d.weightedKill / maxKill) * 100;
    const deadScore = (Number(d.deadsDelta) / maxDead) * 100;
    const powerBonus = Number(d.powerDelta) < 0 ? 5.0 : 0.0;
    const warriorScore = Math.min(
      (killScore * 0.55) + (deadScore * 0.40) + powerBonus,
      100
    );

    return {
      governorId: d.governorId,
      governorName: d.governorName,
      killScore: Math.round(killScore * 10) / 10,
      deadScore: Math.round(deadScore * 10) / 10,
      powerBonus,
      warriorScore: Math.round(warriorScore * 10) / 10,
      tier: getWarriorTier(warriorScore),
      rank: 0  // Set after sorting
    };
  });

  // Step 4: Sort and assign ranks
  results.sort((a, b) => b.warriorScore - a.warriorScore);
  results.forEach((r, i) => r.rank = i + 1);

  return results;
}

function getWarriorTier(score: number): WarriorTier {
  if (score >= 90) return 'War Legend';
  if (score >= 70) return 'Elite Warrior';
  if (score >= 50) return 'Frontline Fighter';
  if (score >= 30) return 'Support Role';
  return 'Inactive';
}

function getTierConfig(tier: WarriorTier) {
  const configs = {
    'War Legend':        { emoji: '🏆', color: '#f59e0b', label: 'War Legend' },
    'Elite Warrior':     { emoji: '⚔️', color: '#8b5cf6', label: 'Elite Warrior' },
    'Frontline Fighter': { emoji: '🛡️', color: '#3b82f6', label: 'Frontline Fighter' },
    'Support Role':      { emoji: '🏹', color: '#10b981', label: 'Support Role' },
    'Inactive':          { emoji: '💤', color: '#64748b', label: 'Inactive' },
  };
  return configs[tier];
}
```

---

## FAQ

**Q: Why not just use Kill Points delta for ranking?**
A: Kill Points alone rewards "safe" players who rally from behind the flag. Deaths prove front-line commitment.

**Q: Won't this punish low-power players?**
A: No — normalization scales every governor relative to the event maximum. A 30M power player who gives 100% of their army gets the same Dead Score as a 100M player who gives 100%.

**Q: What if someone has 0 kills but high deaths?**
A: They'd score up to 40/100 (Dead Score only). This is intentional — pure meat-shield play is valuable but incomplete. Ideal warriors both kill and die.

**Q: Can the formula be customized?**
A: Yes. The weights (0.55, 0.40, 5.0) and tier thresholds are configurable. Alliance leaders can adjust them in the settings.
