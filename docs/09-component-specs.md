# Component Specifications

Detailed specs for every React component in the project.

---

## 1. Navbar

**File:** `src/components/Navbar.tsx`  
**Rendering:** Server Component  
**Props:** None

### Visual Design
```
┌─────────────────────────────────────────────────────────┐
│  ⚔️ RoK Command Center     Dashboard  Upload  Events  Compare  Governors │
└─────────────────────────────────────────────────────────┘
```

### Behavior
- Fixed position at top
- Glassmorphism background with `backdrop-filter: blur(20px)`
- Active page indicated by gold underline
- Mobile: Collapses to hamburger menu (≤768px)
- Logo links to `/`

### CSS Classes
```css
.navbar { position: fixed; top: 0; z-index: 100; backdrop-filter: blur(20px); }
.navbar-links a.active { border-bottom: 2px solid var(--color-accent-gold); }
```

---

## 2. StatsCard

**File:** `src/components/StatsCard.tsx`  
**Rendering:** Server Component (receives data as props)

### Props
```typescript
interface StatsCardProps {
  icon: string;      // Emoji icon
  label: string;     // "Total Governors"
  value: string;     // "102"
  subtitle?: string; // Optional secondary text
  trend?: 'up' | 'down' | 'neutral';
}
```

### Visual Design
```
┌─────────────────┐
│  📊              │
│  Total Governors │
│  102             │
│  ▲ +5 this month │
└─────────────────┘
```

### CSS Classes
```css
.stats-card {
  background: var(--color-bg-glass);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 24px;
  transition: transform 200ms ease-out;
}
.stats-card:hover { transform: translateY(-4px); }
```

---

## 3. DropZone

**File:** `src/components/DropZone.tsx`  
**Rendering:** Client Component (`'use client'`)

### Props
```typescript
interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;        // Default: 50
  acceptedTypes?: string[]; // Default: ['image/png', 'image/jpeg', 'image/webp']
  disabled?: boolean;
}
```

### State
```typescript
const [isDragging, setIsDragging] = useState(false);
const [fileCount, setFileCount] = useState(0);
```

### Visual States
- **Default**: Dashed border, icon, "Drag & Drop" text
- **Dragging**: Gold border, pulsing background, "Release to upload" text
- **Disabled**: Grayed out, "Processing..." text
- **Files loaded**: Shows count badge

### Events Handled
- `onDragEnter` → set dragging state
- `onDragLeave` → clear dragging state
- `onDrop` → validate files, call `onFilesSelected`
- `onClick` → open native file picker
- `onChange` (input) → handle file picker selection

---

## 4. OcrReviewPanel

**File:** `src/components/OcrReviewPanel.tsx`  
**Rendering:** Client Component (`'use client'`)

### Props
```typescript
interface OcrReviewPanelProps {
  screenshot: File;
  ocrResult: OcrResult;
  onConfirm: (data: VerifiedGovernorData) => void;
  onSkip: () => void;
  previousSnapshot?: Snapshot; // For cross-reference validation
}

interface OcrResult {
  governorId: { value: string; confidence: number };
  name: { value: string; confidence: number };
  power: { value: string; confidence: number };
  killPoints: { value: string; confidence: number };
  t4Kills: { value: string; confidence: number };
  t5Kills: { value: string; confidence: number };
  deads: { value: string; confidence: number };
  croppedImages: Record<string, string>; // Base64 crops per field
}
```

### State
```typescript
const [editingField, setEditingField] = useState<string | null>(null);
const [values, setValues] = useState<Record<string, string>>(initialValues);
const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
```

### Visual Layout
```
┌──────────────────────────────────────────┐
│  📷 [Cropped Image]  │  Field: [value] ✅│
│                      │  Field: [value] ⚠️│
│                      │  ...              │
│  Confidence: 94%     │                   │
│  [Confirm] [Edit] [Skip]                │
└──────────────────────────────────────────┘
```

### Interactions
- Click field value → enters edit mode (inline input)
- Press Enter → save edit, re-validate
- Click ✅ Confirm → calls `onConfirm` with values
- Click ❌ Skip → calls `onSkip`
- Cropped image shown next to corresponding field for visual verification

---

## 5. EventSelector

**File:** `src/components/EventSelector.tsx`  
**Rendering:** Client Component (`'use client'`)

### Props
```typescript
interface EventSelectorProps {
  label?: string;          // "Select Event"
  selectedEventId?: string;
  onChange: (eventId: string) => void;
  showCreateButton?: boolean;
  onCreateEvent?: (name: string, type: EventType) => void;
}
```

### Behavior
- Fetches events from `/api/events` on mount
- Renders as styled dropdown
- Optional "+" button opens create modal
- Shows event name + date + player count in dropdown items

---

## 6. DeltaTable

**File:** `src/components/DeltaTable.tsx`  
**Rendering:** Client Component (`'use client'`)

### Props
```typescript
interface DeltaTableProps {
  comparisons: ComparisonResult[];
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

interface ComparisonResult {
  governor: { id: string; name: string; governorId: string };
  deltas: {
    power: string;
    killPoints: string;
    t4Kills: string;
    t5Kills: string;
    deads: string;
  };
  warriorScore: {
    totalScore: number;
    tier: WarriorTier;
    rank: number;
  };
}
```

### Features
- **Sortable columns**: Click header to sort by any column
- **Search filter**: Type to filter by governor name
- **Color coding**: Positive deltas = green, negative = red
- **Number formatting**: Large numbers abbreviated (85M instead of 85,000,000)
- **Sticky header**: Header stays visible during scroll
- **Row hover**: Subtle highlight on hover

### Table Columns
| Column | Sortable | Format |
|--------|----------|--------|
| Rank   | No       | #1, #2, #3 |
| Governor | Yes    | Name with ID |
| Power Δ | Yes     | +5M 🟢 / -3M 🔴 |
| Kill Pts Δ | Yes  | +80M 🟢 |
| T4 Kills Δ | Yes  | +20M |
| T5 Kills Δ | Yes  | +15M |
| Deads Δ | Yes     | +30M |
| Warrior Score | Yes | 95.0 with tier badge |

---

## 7. WarriorScoreCard

**File:** `src/components/WarriorScoreCard.tsx`  
**Rendering:** Client Component (`'use client'`)

### Props
```typescript
interface WarriorScoreCardProps {
  rank: number;
  governorName: string;
  score: number;
  tier: WarriorTier;
  killScore: number;
  deadScore: number;
  powerBonus: number;
  animate?: boolean; // Animate score bar on mount
}
```

### Visual Design
```
┌──────────────────────────────────────────┐
│  #1  DragonSlayer                        │
│  ████████████████████████████ 95.0  🏆   │
│                                          │
│  Kill: 55.0/55  Dead: 40.0/40  PWR: 0.0│
└──────────────────────────────────────────┘
```

### Animation
- Score bar fills from 0% to actual percentage over 800ms
- Tier badge appears with a bounce effect after bar fills
- Staggered animation delay based on rank (rank 1 first, rank 2 after 100ms, etc.)

---

## 8. TierBadge

**File:** `src/components/TierBadge.tsx`  
**Rendering:** Server Component

### Props
```typescript
interface TierBadgeProps {
  tier: WarriorTier;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean; // Show text label alongside emoji
}
```

### Rendered Output
```html
<span class="tier-badge tier-badge--war-legend tier-badge--lg">
  🏆 War Legend
</span>
```

### Tier Styles
```css
.tier-badge--war-legend     { background: rgba(245,158,11,0.15); color: #f59e0b; }
.tier-badge--elite-warrior  { background: rgba(139,92,246,0.15); color: #8b5cf6; }
.tier-badge--frontline      { background: rgba(59,130,246,0.15); color: #3b82f6; }
.tier-badge--support        { background: rgba(16,185,129,0.15); color: #10b981; }
.tier-badge--inactive       { background: rgba(100,116,139,0.15); color: #64748b; }
```

---

## 9. Charts

**File:** `src/components/Charts.tsx`  
**Rendering:** Client Component (`'use client'`)

### Exported Components

#### KillsBarChart
```typescript
interface KillsBarChartProps {
  data: { name: string; killDelta: number }[];
  maxItems?: number; // Top N to display
}
```
- Horizontal bar chart
- Sorted by kill delta (descending)
- Gold bars with hover tooltip showing exact number
- Responsive width

#### TierPieChart
```typescript
interface TierPieChartProps {
  distribution: Record<WarriorTier, number>;
}
```
- Donut chart with tier colors
- Center text: total count
- Hover: show percentage + count
- Legend with tier labels

#### GrowthLineChart
```typescript
interface GrowthLineChartProps {
  timeline: {
    eventName: string;
    date: string;
    power: number;
    killPoints: number;
    deads: number;
  }[];
  metrics?: ('power' | 'killPoints' | 'deads')[];
}
```
- Multi-line chart
- Toggleable metrics
- X-axis: event names/dates
- Y-axis: auto-scaled values
- Tooltip with all values

#### PerformanceRadarChart
```typescript
interface PerformanceRadarChartProps {
  data: {
    governorName: string;
    killScore: number;
    deadScore: number;
    powerDelta: number;
    t4Ratio: number;
    t5Ratio: number;
  };
}
```
- 5-axis radar chart
- Shows balanced vs specialized performance
- Fill area with transparency
- Gold stroke color

---

## 10. LoadingShimmer

**File:** `src/components/LoadingShimmer.tsx`  
**Rendering:** Server Component

### Props
```typescript
interface LoadingShimmerProps {
  variant: 'card' | 'table-row' | 'text' | 'chart';
  count?: number; // How many shimmer items to show
}
```

### Animation
```css
@keyframes shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}

.loading-shimmer {
  background: linear-gradient(
    90deg,
    var(--color-bg-secondary) 0px,
    rgba(255,255,255,0.05) 40px,
    var(--color-bg-secondary) 80px
  );
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite linear;
  border-radius: 8px;
}
```

---

## Component Dependency Graph

```
Layout
├── Navbar
│
├── Dashboard (page.tsx)
│   ├── StatsCard (×3)
│   ├── EventsList (inline)
│   └── WarriorScoreCard (×3, mini variant)
│
├── Upload (page.tsx)
│   ├── EventSelector
│   ├── DropZone
│   └── OcrReviewPanel (×N)
│       └── TierBadge
│
├── Events (page.tsx)
│   └── EventSelector (inline)
│
├── Event Detail ([id]/page.tsx)
│   └── DeltaTable (simplified, no deltas)
│
├── Compare (page.tsx)
│   ├── EventSelector (×2)
│   ├── WarriorScoreCard (×N)
│   │   └── TierBadge
│   ├── DeltaTable
│   │   └── TierBadge
│   └── Charts
│       ├── KillsBarChart
│       ├── TierPieChart
│       └── PerformanceRadarChart
│
└── Governors (page.tsx)
    ├── DeltaTable (simplified)
    └── Charts
        └── GrowthLineChart
```
