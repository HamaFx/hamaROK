# Snapshot Comparison Logic — Detailed Design

## Overview

The snapshot comparison system is the core feature. It allows alliance leaders to measure **actual contribution** by comparing stats at two points in time.

---

## Terminology

| Term       | Definition                                             |
|------------|--------------------------------------------------------|
| **Event**  | A point-in-time marker (e.g., "KvK Start")            |
| **Snapshot** | A governor's stats at a specific event               |
| **Delta** | The difference between two snapshots (B - A)            |
| **Comparison** | The full analysis: deltas + warrior scores for all governors |

---

## Comparison Flow

```
User selects Event A                 User selects Event B
(e.g., "KvK Start")                 (e.g., "KvK End")
         │                                    │
         ▼                                    ▼
┌─────────────────┐                ┌─────────────────┐
│ Snapshot A:     │                │ Snapshot B:     │
│ Governor 1: ... │                │ Governor 1: ... │
│ Governor 2: ... │                │ Governor 2: ... │
│ Governor 3: ... │                │ Governor 3: ... │
│ Governor 4: ... │                │                  │  ←── Governor 4 missing
│                  │                │ Governor 5: ... │  ←── Governor 5 new
└────────┬────────┘                └────────┬────────┘
         │                                    │
         └──────────┬─────────────────────────┘
                    │
                    ▼
         ┌────────────────────┐
         │  Match governors   │
         │  Calculate deltas  │
         │  Handle edge cases │
         └────────┬───────────┘
                  │
                  ▼
         ┌────────────────────┐
         │  Calculate Warrior │
         │  Scores & Rank     │
         └────────┬───────────┘
                  │
                  ▼
         ┌────────────────────┐
         │  Return results    │
         │  with 3 categories:│
         │  - Matched (delta) │
         │  - Missing in B   │ 
         │  - New in B       │
         └────────────────────┘
```

---

## Matching Logic

Governors are matched by their internal database `governorId` (which corresponds to the in-game Governor ID).

```typescript
async function compareEvents(eventAId: string, eventBId: string) {
  // 1. Fetch all snapshots for both events
  const snapshotsA = await prisma.snapshot.findMany({
    where: { eventId: eventAId },
    include: { governor: true }
  });
  
  const snapshotsB = await prisma.snapshot.findMany({
    where: { eventId: eventBId },
    include: { governor: true }
  });

  // 2. Create lookup maps
  const mapA = new Map(snapshotsA.map(s => [s.governorId, s]));
  const mapB = new Map(snapshotsB.map(s => [s.governorId, s]));

  // 3. Find matched governors (in both events)
  const matched = [];
  const missingInB = [];
  const newInB = [];

  for (const [govId, snapA] of mapA) {
    const snapB = mapB.get(govId);
    if (snapB) {
      matched.push({
        governor: snapA.governor,
        snapshotA: snapA,
        snapshotB: snapB,
        deltas: calculateDeltas(snapA, snapB)
      });
    } else {
      missingInB.push({
        governor: snapA.governor,
        snapshotA: snapA,
        reason: 'Governor not found in Event B'
      });
    }
  }

  for (const [govId, snapB] of mapB) {
    if (!mapA.has(govId)) {
      newInB.push({
        governor: snapB.governor,
        snapshotB: snapB,
        reason: 'Governor not in Event A (new member?)'
      });
    }
  }

  // 4. Calculate warrior scores for matched governors
  const warriorScores = calculateWarriorScores(
    matched.map(m => ({
      governorId: m.governor.id,
      governorName: m.governor.name,
      killPointsDelta: m.deltas.killPoints,
      t4KillsDelta: m.deltas.t4Kills,
      t5KillsDelta: m.deltas.t5Kills,
      deadsDelta: m.deltas.deads,
      powerDelta: m.deltas.power
    }))
  );

  return { matched, missingInB, newInB, warriorScores };
}
```

---

## Delta Calculation

```typescript
interface SnapshotDeltas {
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
}

function calculateDeltas(snapA: Snapshot, snapB: Snapshot): SnapshotDeltas {
  return {
    power:      snapB.power      - snapA.power,
    killPoints: snapB.killPoints - snapA.killPoints,
    t4Kills:    snapB.t4Kills    - snapA.t4Kills,
    t5Kills:    snapB.t5Kills    - snapA.t5Kills,
    deads:      snapB.deads      - snapA.deads,
  };
}
```

### Delta Validation

After calculating deltas, flag suspicious values:

```typescript
function validateDeltas(deltas: SnapshotDeltas): DeltaWarning[] {
  const warnings: DeltaWarning[] = [];
  
  // Kill points should never decrease
  if (deltas.killPoints < 0n) {
    warnings.push({
      field: 'killPoints',
      message: 'Kill points decreased — check for OCR error in either snapshot',
      severity: 'error'
    });
  }

  // Dead count should never decrease
  if (deltas.deads < 0n) {
    warnings.push({
      field: 'deads',
      message: 'Dead count decreased — impossible, likely OCR error',
      severity: 'error'
    });
  }

  // T4/T5 kills should never decrease
  if (deltas.t4Kills < 0n || deltas.t5Kills < 0n) {
    warnings.push({
      field: 't4Kills',
      message: 'Kill count decreased — check screenshots',
      severity: 'error'
    });
  }

  // Power decrease > 50% is suspicious
  // (This would mean someone zeroed their account)
  // Note: Power CAN decrease legitimately (traps killed, etc.)
  
  return warnings;
}
```

---

## Edge Cases

### Governor in A but not in B
**Scenario**: A member left the alliance between snapshots.
**Handling**: Listed in `missingInB` array with their Event A data.
**UI**: Shown in a separate "Missing Members" section with a warning badge.

### Governor in B but not in A
**Scenario**: A new member joined between snapshots.
**Handling**: Listed in `newInB` array with their Event B data.
**UI**: Shown in a separate "New Members" section with an info badge.

### Same governor, different names
**Scenario**: Player renamed their governor between snapshots.
**Handling**: Matched by `governorId` (in-game ID), not name. Name from latest snapshot is used.
**No action needed** — this is handled automatically.

### Zero deltas
**Scenario**: Governor's stats didn't change between events.
**Handling**: Valid result. Warrior Score = 0 → "Inactive" tier.
**UI**: Shown normally with gray styling.

### Negative power delta
**Scenario**: Governor lost power (troops killed in war).
**Handling**: Valid and expected during KvK. Awards 5-point Warrior Score bonus.
**UI**: Shown in red with a special "⚔️ Fighter" indicator.

---

## Multiple Comparison Workflow

Alliance leaders often need to run multiple comparisons:
- KvK Start → KvK End (overall performance)
- Week 1 → Week 2 (weekly progress)
- Pre-MGE → Post-MGE (event-specific tracking)

The system supports unlimited events and any-to-any comparison. States are not persisted — each comparison is calculated fresh from the stored snapshots.

---

## Export Format

The comparison results can be exported as CSV:

```csv
Rank,Governor,Governor ID,Power Start,Power End,Power Delta,Kill Pts Start,Kill Pts End,Kill Pts Delta,T4 Kills Start,T4 Kills End,T4 Kills Delta,T5 Kills Start,T5 Kills End,T5 Kills Delta,Deads Start,Deads End,Deads Delta,Warrior Score,Tier
1,DragonSlayer,23456789,120000000,125000000,5000000,300000000,380000000,80000000,80000000,100000000,20000000,35000000,50000000,15000000,55000000,85000000,30000000,95.0,War Legend
2,HamaWarlord,45678901,85000000,82000000,-3000000,150000000,220000000,70000000,45000000,65000000,20000000,12000000,20000000,8000000,30000000,60000000,30000000,83.3,Elite Warrior
```

---

## Performance Considerations

### Query Optimization
- The comparison query JOINs 3 tables (Snapshot × Governor × Event)
- With 100 governors × 2 events = 200 snapshots → trivial query
- Indexes on `eventId` and `governorId` ensure fast lookups

### Caching
- Comparison results are not cached (always computed fresh)
- This ensures modifications to snapshots are immediately reflected
- With 200 rows, computation is instant (<100ms)

### BigInt Handling
- All stats stored as `BigInt` in PostgreSQL
- Prisma returns JavaScript `BigInt` objects
- Deltas computed with BigInt arithmetic (no precision loss)
- Serialized to strings for JSON API responses
- Warrior Score calculation converts to `Number` (safe for normalized 0-100 scores)
