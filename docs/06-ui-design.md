# UI Design — Pages & Components

## Design Language

### Theme: "Military Command Center"
- **Dark mode only** — reduces eye strain during long management sessions
- **Gold accents** — matches RoK's in-game aesthetic
- **Glassmorphism** — frosted glass card effects for depth
- **Military typography** — Rajdhani font for headings (angular, commanding)
- **Micro-animations** — subtle hover effects, score reveals, loading shimmer

### Color Palette

```
┌─────────────────────────────────────────────────┐
│  Background Layer                                │
│  ██████ #0a0e1a  Deep Space Navy (Primary BG)   │
│  ██████ #111827  Card Surface (Secondary BG)    │
│  ██████ rgba(17,24,39,0.6)  Glass Effect        │
│                                                  │
│  Accent Colors                                   │
│  ██████ #f59e0b  RoK Gold (Primary Accent)      │
│  ██████ #8b5cf6  Elite Purple                    │
│  ██████ #3b82f6  Tactical Blue                   │
│  ██████ #10b981  Success Green                   │
│  ██████ #ef4444  Danger Red                      │
│                                                  │
│  Text                                            │
│  ██████ #f1f5f9  Primary Text (Bright)           │
│  ██████ #94a3b8  Secondary Text (Muted)          │
│  ██████ #475569  Disabled Text                   │
└─────────────────────────────────────────────────┘
```

### Typography

```
Headings:  'Rajdhani', sans-serif  (700 weight)
Body:      'Inter', sans-serif     (400/500/600 weight)
Monospace: 'JetBrains Mono', monospace  (for numbers/stats)
```

---

## Page Layouts

### 1. Dashboard (Home Page) — `/`

The landing page shows an alliance overview at a glance.

```
┌─────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center              [Upload] [Compare] │  ← Navbar
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ 📊 Total   │  │ 📸 Latest  │  │ ⚔️ Active  │         │  ← Stats Cards
│  │ Governors  │  │ Event      │  │ Warriors   │         │
│  │    102     │  │ KvK S3 End │  │    87      │         │
│  └────────────┘  └────────────┘  └────────────┘         │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │  📅 Recent Events                              │       │
│  │                                                │       │  ← Events List
│  │  KvK S3 - End       87 players   Jul 15, 2025 │       │
│  │  KvK S3 - Start     85 players   Jun 01, 2025 │       │
│  │  Weekly Check #12    90 players   May 25, 2025 │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │  🏆 Top Warriors (Latest Comparison)          │       │
│  │                                                │       │  ← Mini Leaderboard
│  │  1. DragonSlayer   95.0  🏆 War Legend         │       │
│  │  2. HamaWarlord    83.3  ⚔️ Elite Warrior      │       │
│  │  3. StormRider     78.5  ⚔️ Elite Warrior      │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

### 2. Upload Page — `/upload`

Batch screenshot upload with real-time OCR processing and review.

```
┌─────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center              [Upload] [Compare] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Step 1: Select Event                                    │
│  ┌──────────────────────────────────────────────┐       │
│  │  [▼ Select existing event ]  or  [+ New Event]│       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  Step 2: Upload Screenshots                              │
│  ┌──────────────────────────────────────────────┐       │
│  │                                                │       │
│  │      📸 Drag & Drop Screenshots Here           │       │
│  │         or click to browse                     │       │
│  │                                                │       │
│  │      Supports: PNG, JPG, WEBP                  │       │
│  │      Max: 50 screenshots per batch             │       │
│  │                                                │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  Step 3: Review OCR Results                              │
│  ┌──────────────────────────────────────────────┐       │
│  │  Processing: ████████████░░░░░░  12/20        │       │  ← Progress
│  │                                                │       │
│  │  ┌─────────────────────────────────────────┐  │       │
│  │  │ 📷 [Cropped Preview]                     │  │       │
│  │  │                                          │  │       │
│  │  │ Governor ID:  [45678901    ] ✅           │  │       │
│  │  │ Name:         [HamaWarlord  ] ✅           │  │       │
│  │  │ Power:        [85,000,000   ] ✅           │  │       │
│  │  │ Kill Points:  [150,000,000  ] ✅           │  │       │
│  │  │ T4 Kills:     [45,000,000   ] ✅           │  │       │  ← Review Card
│  │  │ T5 Kills:     [12,000,000   ] ✅           │  │       │
│  │  │ Deads:        [30,000,000   ] ✅           │  │       │
│  │  │                                          │  │       │
│  │  │ Confidence: 94%  ⚠️ No warnings          │  │       │
│  │  │ [✅ Confirm]  [✏️ Edit]  [❌ Skip]        │  │       │
│  │  └─────────────────────────────────────────┘  │       │
│  │                                                │       │
│  │  ┌─────────────────────────────────────────┐  │       │
│  │  │ 📷 [Next Governor...]                    │  │       │
│  │  └─────────────────────────────────────────┘  │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  [💾 Save All Confirmed (12/20)]                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Interactive Features:**
- Drag-and-drop with file count indicator
- Real-time OCR processing with progress bar
- Each field is editable (click to type correct value)
- Validation indicators (✅ ⚠️ ❌) next to each field
- Batch save button with count of confirmed entries

---

### 3. Events Page — `/events`

List and manage events.

```
┌─────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center              [Upload] [Compare] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  📅 Events                          [+ Create New Event] │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │  🏛️ KvK S3 - End                              │       │
│  │  Type: KVK_END │ 87 players │ Jul 15, 2025    │       │
│  │  [View Details]  [📊 Compare]  [🗑️ Delete]    │       │
│  ├──────────────────────────────────────────────┤       │
│  │  🏛️ KvK S3 - Start                            │       │
│  │  Type: KVK_START │ 85 players │ Jun 01, 2025  │       │
│  │  [View Details]  [📊 Compare]  [🗑️ Delete]    │       │
│  ├──────────────────────────────────────────────┤       │
│  │  🏛️ Weekly Check #12                          │       │
│  │  Type: WEEKLY │ 90 players │ May 25, 2025     │       │
│  │  [View Details]  [📊 Compare]  [🗑️ Delete]    │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

### 4. Event Detail Page — `/events/[id]`

All governor snapshots for a specific event.

```
┌──────────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center                [Upload] [Compare]    │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  📅 KvK S3 - Start  │  KVK_START  │  87 players              │
│  Created: Jun 01, 2025                                        │
│                                                               │
│  🔍 [Search governor...]                                      │
│                                                               │
│  ┌────┬──────────┬───────────────┬──────────┬─────────────┐  │
│  │ #  │ Governor │ Power         │ Kill Pts │ Deads       │  │
│  ├────┼──────────┼───────────────┼──────────┼─────────────┤  │
│  │ 1  │ Dragon   │ 120,000,000   │ 300M     │ 55,000,000  │  │
│  │ 2  │ Hama     │  85,000,000   │ 150M     │ 30,000,000  │  │
│  │ 3  │ Silent   │  45,000,000   │  25M     │  8,000,000  │  │
│  │ .. │ ...      │ ...           │ ...      │ ...         │  │
│  └────┴──────────┴───────────────┴──────────┴─────────────┘  │
│                                                               │
│  [📤 Export CSV]  [📸 Upload More]                             │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

### 5. Compare Page — `/compare`

The star feature: side-by-side snapshot comparison with Warrior Scores.

```
┌──────────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center                [Upload] [Compare]    │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  📊 Compare Events                                            │
│                                                               │
│  ┌───────────────────┐     ┌───────────────────┐             │
│  │ Event A (Start)   │ vs  │ Event B (End)     │             │
│  │ [▼ KvK S3-Start ] │     │ [▼ KvK S3-End   ] │             │
│  └───────────────────┘     └───────────────────┘             │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  🏆 Warrior Score Leaderboard                         │    │
│  │                                                        │    │
│  │  #1  DragonSlayer   ████████████████████ 95.0  🏆     │    │
│  │  #2  HamaWarlord    ████████████████░░░░ 83.3  ⚔️     │    │
│  │  #3  StormRider     ███████████████░░░░░ 78.5  ⚔️     │    │
│  │  #4  NightHawk      ████████████░░░░░░░░ 62.1  🛡️     │    │
│  │  #5  SilentBlade    ██░░░░░░░░░░░░░░░░░░ 13.9  💤     │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  📊 Delta Table                [Sort ▼] [Search 🔍]  │    │
│  │                                                        │    │
│  │  Governor    │ Power Δ    │ Kill Δ    │ Dead Δ  │Score │    │
│  │  ──────────────────────────────────────────────────── │    │
│  │  Dragon      │ +5M  🟢   │ +80M  🟢  │ +30M 🟢 │ 95.0│    │
│  │  Hama        │ -3M  🔴   │ +70M  🟢  │ +30M 🟢 │ 83.3│    │
│  │  Silent      │ +10M 🟢   │ +10M  🟢  │ +5M  🟢 │ 13.9│    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │  📊 Kill Distribution│  │  🎯 Tier Distribution│           │
│  │  [BAR CHART]         │  │  [PIE CHART]         │           │
│  │                      │  │                      │           │
│  │  Dragon ████████     │  │  🏆  5  (6%)         │           │
│  │  Hama   ███████      │  │  ⚔️  12 (14%)        │           │
│  │  Storm  █████        │  │  🛡️  25 (29%)        │           │
│  │  Night  ████         │  │  🏹  30 (34%)        │           │
│  │  Silent ██           │  │  💤  15 (17%)        │           │
│  └─────────────────────┘  └─────────────────────┘           │
│                                                               │
│  [📤 Export Full Report]                                      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**Chart Types:**
- **Bar Chart**: Kill point deltas (horizontal bars, sorted descending)
- **Pie Chart**: Warrior tier distribution
- **Radar Chart**: Individual governor performance profile (click a governor to see)

---

### 6. Governor Profile — `/governors`

Roster and individual governor timelines.

```
┌──────────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center                [Upload] [Compare]    │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  👥 Governor Roster  │  102 members                           │
│  🔍 [Search...]                                               │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Governor      │ ID       │ Power     │ Snapshots    │    │
│  │  ────────────────────────────────────────────────── │    │
│  │  DragonSlayer  │ 23456789 │ 125M      │ 5 events    │    │
│  │  HamaWarlord   │ 45678901 │ 82M       │ 5 events    │    │
│  │  StormRider    │ 34567890 │ 95M       │ 4 events    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ── Governor Detail (Expanded) ──                             │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  📈 HamaWarlord — Growth Timeline                     │    │
│  │                                                        │    │
│  │  [LINE CHART]                                          │    │
│  │  Power:  85M ──── 82M ──── 90M ──── 95M               │    │
│  │  Kills: 150M ─── 220M ─── 280M ─── 350M               │    │
│  │                                                        │    │
│  │  Jun 1    Jul 15   Aug 30    Oct 15                    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### Shared Components

| Component          | File                      | Description                            |
|--------------------|---------------------------|----------------------------------------|
| Navbar             | `components/Navbar.tsx`   | Top navigation with logo + links       |
| StatsCard          | `components/StatsCard.tsx`| Glassmorphism stat card with icon      |
| EventSelector      | `components/EventSelector.tsx` | Dropdown to pick events           |
| DeltaTable         | `components/DeltaTable.tsx`    | Sortable comparison table         |
| WarriorScoreCard   | `components/WarriorScoreCard.tsx` | Score with bar + tier badge    |
| OcrReviewPanel     | `components/OcrReviewPanel.tsx`   | OCR results with editable fields|
| Charts             | `components/Charts.tsx`          | Recharts wrapper components     |
| DropZone           | `components/DropZone.tsx`        | Drag-and-drop upload area       |
| TierBadge          | `components/TierBadge.tsx`       | Colored badge for warrior tier  |
| LoadingShimmer     | `components/LoadingShimmer.tsx`  | Skeleton loading animation      |

### Client vs Server Components

| Component          | Rendering | Why                                  |
|--------------------|-----------|--------------------------------------|
| Navbar             | Server    | Static, no interactivity             |
| StatsCard          | Server    | Receives data as props               |
| EventSelector      | Client    | Dropdown interaction                 |
| DeltaTable         | Client    | Sortable, searchable                 |
| WarriorScoreCard   | Client    | Animated score reveal                |
| OcrReviewPanel     | Client    | Editable fields, OCR processing      |
| Charts             | Client    | Recharts requires browser APIs       |
| DropZone           | Client    | File drag-and-drop                   |

---

## Responsive Breakpoints

```css
/* Mobile first */
@media (min-width: 640px)  { /* sm  - Tablet portrait  */ }
@media (min-width: 768px)  { /* md  - Tablet landscape */ }
@media (min-width: 1024px) { /* lg  - Desktop          */ }
@media (min-width: 1280px) { /* xl  - Wide desktop      */ }
```

### Layout Behavior

| Page     | Mobile              | Desktop                  |
|----------|---------------------|--------------------------|
| Dashboard| Single column stack | 3-column stats + 2-col grid |
| Upload   | Full width          | Centered max-width 800px |
| Compare  | Stacked sections    | Side-by-side charts      |
| Events   | Card list           | Table with actions       |

---

## Animation Specs

| Animation             | Trigger          | Duration | Easing          |
|-----------------------|------------------|----------|-----------------|
| Card hover lift       | Mouse enter      | 200ms    | ease-out        |
| Score bar fill        | Scroll into view | 800ms    | ease-in-out     |
| Tier badge bounce     | Score calculated  | 300ms    | cubic-bezier    |
| Table row fade-in     | Data loaded       | 150ms    | ease-in (stagger)|
| Shimmer loading       | Data pending      | 1500ms   | linear (loop)   |
| Drag-drop highlight   | File hover        | 150ms    | ease-out        |
| Notification toast    | Action complete   | 300ms    | ease-out        |
