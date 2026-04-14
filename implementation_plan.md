# HamaROK — Complete Upgrade Implementation Plan

Comprehensive upgrades to properly track weekly activities (tech contribution, fort destroying), progressive metrics (power growth, kill points), and add weekly navigation, ranking filters, an activity dashboard, and OCR hardening.

## User Review Required

> [!IMPORTANT]
> **Database migration required.** Phase 1 adds two new enum values (`FORT_DESTROYING`, `KILL_POINTS_GROWTH`) to the `ActivityMetricKey` Prisma enum. This will require running `npx prisma migrate dev` and redeploying. Existing data is unaffected — this is additive only.

> [!WARNING]
> **New page added.** Phase 2 introduces a new `/activity` page that becomes the primary weekly compliance dashboard. This adds a new nav entry in the sidebar. Confirm you want it in the **Core** nav group (alongside Dashboard, Upload, Events, Governors).

---

## Proposed Changes

### Phase 1 — Activity System Completion (Backend)
Adds fort destroying and kill points growth as tracked weekly metrics with configurable per-alliance standards.

---

#### [MODIFY] [schema.prisma](file:///home/ubuntu/hamaROK/prisma/schema.prisma)
- Add `FORT_DESTROYING` and `KILL_POINTS_GROWTH` to `ActivityMetricKey` enum
- This enables storing per-alliance minimum standards for these two new activity types

```diff
 enum ActivityMetricKey {
   POWER_GROWTH
   CONTRIBUTION_POINTS
+  FORT_DESTROYING
+  KILL_POINTS_GROWTH
 }
```

---

#### [MODIFY] [service.ts](file:///home/ubuntu/hamaROK/src/lib/activity/service.ts)
- Expand `WeeklyMetricKey` type to include `'fort_destroying' | 'kill_points_growth'`
- Add `toMetricEnum` / `fromMetricEnum` mappings for the 2 new keys
- Add `METRIC_KEY_FORT_DESTROYING` and `METRIC_KEY_KILL_POINTS` normalized constants
- In `getWeeklyActivityReport()`:
  - Query current fort destroying RankingSnapshot rows (metric key = `fort_destroying` or normalized variants)
  - Query current and previous kill points from Snapshot model (progressive, delta calculated like power growth)
  - Include both in per-governor output with compliance scoring
  - Add `fortDestroying` and `killPointsGrowth` fields to the response rows
- Add fort/kill to alliance summary totals

---

#### [MODIFY] [page.tsx (Settings)](file:///home/ubuntu/hamaROK/src/app/settings/page.tsx)
- Add **Fort Destroying Min** and **Kill Points Growth Min** columns to the weekly standards table
- Wire them into the `standardsPayload` so they save alongside existing contribution/power growth minimums
- Update `ActivityStandardState` interface with `fortDestroying` and `killPointsGrowth` fields
- Add corresponding `handleStandardChange` calls

---

### Phase 2 — Weekly Activity Dashboard (New Page)
A new dedicated page showing pass/fail compliance per player per alliance, with weekly history navigation.

---

#### [NEW] [page.tsx (Activity)](file:///home/ubuntu/hamaROK/src/app/activity/page.tsx)
Full-featured weekly activity dashboard:
- **Week navigator** — dropdown showing available weekly events (current + history), with prev/next buttons
- **Alliance filter** — filter by GODt / V57 / P57R or show all
- **Summary KPI cards** — members tracked, pass rate, total contribution, total power growth, total fort destroys, total KP growth
- **Alliance summary cards** — per-alliance pass/fail/no-standard counts with progress bars
- **Player compliance table** with columns:
  | Rank | Player | Alliance | Contribution | Fort Destroys | Power Growth | KP Growth | Status |
  - Each metric cell shows value + pass/fail icon based on alliance standard
  - Overall compliance: PASS (all pass) / FAIL (any fail) / NO_STANDARD (no minimums set)
  - Sortable by any metric column
- **Top Performers sidebar** — Top 5 by each metric
- Color-coded rows: green for pass, red for fail, gray for no standard

---

#### [MODIFY] [AppShell.tsx](file:///home/ubuntu/hamaROK/src/components/AppShell.tsx)
- Add `/activity` nav entry to the `core` group:
  ```ts
  { href: '/activity', label: 'Activity', hint: 'Weekly compliance and player tracking', icon: Activity, group: 'core' }
  ```
- Add `Activity` to `MOBILE_PRIMARY` array (replaces or supplements current set)

---

### Phase 3 — Rankings Filtering & Week Navigation

---

#### [MODIFY] [page.tsx (Rankings)](file:///home/ubuntu/hamaROK/src/app/rankings/page.tsx)
- Add **Ranking Type filter dropdown** with options:
  - All Types (default)
  - Individual Power
  - Mad Scientist (Contribution)
  - Fort Destroyer
  - Governor Profile Power
- Pass selected `rankingType` to the API query params
- Add **Week selector** — reuse the week dropdown pattern from the activity page
- Pass selected `weekKey` to the API (already supported by backend)
- Add **Metric Key filter** (optional secondary filter)

---

#### [MODIFY] [page.tsx (Rankings)](file:///home/ubuntu/hamaROK/src/app/rankings/page.tsx) — Alliance filter
- Add alliance filter chips (GODt / V57 / P57R / All) below the search bar
- Pass `alliances[]` query param to API

---

### Phase 4 — OCR Hardening for Screenshot Types

---

#### [MODIFY] [ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts)
- In `normalizeRankingTypeLabel()` — add explicit header text mappings:
  ```ts
  // Before generic normalization, check known header patterns
  const HEADER_MAP: Record<string, string> = {
    'INDIVIDUAL POWER': 'individual_power',
    'MAD SCIENTIST': 'mad_scientist',
    'FORT DESTROYER': 'fort_destroyer',
    'GOVERNOR PROFILE': 'governor_profile_power',
  };
  ```
- In `normalizeMetricLabel()` — add explicit metric key mappings:
  ```ts
  const METRIC_MAP: Record<string, string> = {
    'POWER': 'power',
    'CONTRIBUTION': 'contribution_points',
    'CONTRIBUTION POINTS': 'contribution_points',
    'FORT': 'fort_destroying',
    'FORT DESTROY': 'fort_destroying',
    'DESTROY': 'fort_destroying',
    'KILL POINTS': 'kill_points',
  };
  ```
- In `detectScreenshotArchetype()` — extend detection to recognize "MAD SCIENTIST" and "FORT DESTROYER" as `rankboard` archetype (already works via "RANKINGS" check, but add explicit checks for robustness)

---

#### [MODIFY] [normalize.ts (Rankings)](file:///home/ubuntu/hamaROK/src/lib/rankings/normalize.ts)
- Update `normalizeRankingType()` to handle the known ranking type synonyms
- Update `normalizeMetricKey()` to map "fort_destroyer" → "fort_destroying", "mad_scientist" → "contribution_points" for consistent storage

---

### Phase 5 — Dashboard Enhancements & Governor Detail

---

#### [MODIFY] [page.tsx (Dashboard)](file:///home/ubuntu/hamaROK/src/app/page.tsx)
- Add **Weekly Activity Summary widget**:
  - Fetch `/api/v2/activity/weekly` on load
  - Show alliance-level pass/fail counts as compact progress bars
  - Show link to `/activity` page
- Add **Top Performers widget**:
  - Show top 3 by contribution points, top 3 by power growth this week
  - Compact card layout
- Add **Current Week** indicator in the hero section

---

#### [MODIFY] [page.tsx (Governors)](file:///home/ubuntu/hamaROK/src/app/governors/page.tsx)
- Add **weekly activity data** to the governor table:
  - Show current week's contribution points, fort destroys, power growth inline
- In the timeline expansion:
  - Add ranking-based metrics (contribution, fort) alongside profile metrics (power, KP, deads)
  - Show week-over-week progression chart for all metrics

---

### Phase 6 — Activity API Enhancements

---

#### [MODIFY] [route.ts](file:///home/ubuntu/hamaROK/src/app/api/v2/activity/weekly/route.ts)
- Ensure the response includes `fortDestroying` and `killPointsGrowth` per governor row
- Ensure alliance summary includes totals for all 4 metrics
- Add `weekKeys` endpoint to list available weeks for the week navigator

---

#### [NEW] [route.ts](file:///home/ubuntu/hamaROK/src/app/api/v2/activity/weeks/route.ts)
- New GET endpoint: returns list of all weekly events for a workspace
- Response: `[{ weekKey, name, startsAt, endsAt, isClosed }]`
- Used by the week navigator dropdown in the Activity and Rankings pages

---

## Open Questions

> [!IMPORTANT]
> **Fort destroy reset behavior:** You mentioned activities reset weekly. Does fort destroying count reset each week in the game's ranking board? (i.e., the OCR captures a weekly-resetting leaderboard value, not a cumulative total?) — If so, the value from the ranking board IS the weekly value and doesn't need delta calculation (unlike power/kill points which are cumulative).

> [!IMPORTANT]
> **Kill points tracking source:** Kill points are captured from **governor profile** screenshots (cumulative). To track weekly KP growth, we need two profile snapshots (this week vs last week) to compute the delta. Should we also support a "Kill Points Rankings" board screenshot, or is the profile-based delta sufficient?

> [!NOTE]
> **Alliance standard granularity:** Currently each alliance can have its own minimum thresholds. Should all 3 alliances share the same minimums, or keep them separate (current behavior)?

---

## Verification Plan

### Automated Tests
1. **Prisma migration**: `npx prisma migrate dev` — verify schema compiles cleanly
2. **Build check**: `npm run build` — ensure all TypeScript compiles (no type errors from new enum values)
3. **Activity API**: Test `GET /api/v2/activity/weekly` returns all 4 metrics per governor
4. **Standards API**: Test `PATCH /api/v2/activity/standards` accepts fort_destroying and kill_points_growth payloads
5. **OCR header mapping**: Test `normalizeRankingTypeLabel("FORT DESTROYER RANKINGS")` → `"fort_destroyer"`
6. **OCR metric mapping**: Test `normalizeMetricLabel("CONTRIBUTION POINTS")` → `"contribution_points"`

### Manual Verification
1. Upload each of the 5 example screenshots and verify correct archetype detection and metric key assignment
2. Open the new `/activity` page and verify compliance table renders with all 4 metrics
3. Open Settings page and verify fort destroying / kill points growth minimum fields save correctly
4. Open Rankings page, use ranking type filter, verify filtered results
5. Use week navigator on Activity and Rankings pages to browse historical data
6. Verify Dashboard shows weekly activity summary widget

### Browser Testing
- Navigate to `/activity`, verify the week navigator, alliance filter, and compliance table
- Navigate to `/rankings`, verify ranking type dropdown filter and week selector
- Navigate to `/settings`, verify new standard fields appear and save
- Navigate to `/`, verify weekly activity summary widget and top performers
