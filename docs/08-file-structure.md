# File Structure — Complete Project Map

Every file in the project, its purpose, and its key exports.

```
hamaROK/
│
├── docs/                                 # 📖 Planning documentation (you are here)
│   ├── 00-overview.md                    #    Project overview and workflow
│   ├── 01-tech-stack.md                  #    Technology decisions and rationale
│   ├── 02-database-schema.md             #    Prisma schema, ERD, query patterns
│   ├── 03-ocr-strategy.md               #    3-layer OCR accuracy pipeline
│   ├── 04-warrior-score.md              #    Scoring formula and ranking tiers
│   ├── 05-api-design.md                 #    REST API endpoint specifications
│   ├── 06-ui-design.md                  #    Page wireframes and component breakdown
│   ├── 07-deployment.md                 #    Vercel deployment guide
│   └── 08-file-structure.md             #    This file
│
├── prisma/
│   ├── schema.prisma                     # 🗄️ Database schema definition
│   └── migrations/                       #    Generated migration files
│       └── 001_init/
│           └── migration.sql
│
├── public/
│   └── rok-logo.svg                      # 🎨 App logo (SVG)
│
├── src/
│   ├── app/                              # 📱 Next.js App Router pages
│   │   │
│   │   ├── globals.css                   # 🎨 Global CSS: design system, tokens, themes
│   │   │                                 #    - CSS variables (colors, fonts, spacing)
│   │   │                                 #    - Base element styles
│   │   │                                 #    - Component classes (cards, tables, badges)
│   │   │                                 #    - Utility classes
│   │   │                                 #    - Animations and keyframes
│   │   │                                 #    - Responsive breakpoints
│   │   │
│   │   ├── layout.tsx                    # 📐 Root layout
│   │   │                                 #    - HTML metadata (title, description)
│   │   │                                 #    - Google Fonts (Rajdhani, Inter)
│   │   │                                 #    - Global CSS import
│   │   │                                 #    - Navbar component
│   │   │                                 #    - Children wrapper
│   │   │
│   │   ├── page.tsx                      # 🏠 Dashboard (Home)
│   │   │                                 #    - Stats cards (governors, events, warriors)
│   │   │                                 #    - Recent events list
│   │   │                                 #    - Top warriors mini-leaderboard
│   │   │                                 #    - Quick action buttons
│   │   │
│   │   ├── upload/
│   │   │   └── page.tsx                  # 📸 Upload & OCR page
│   │   │                                 #    - Event selector / creator
│   │   │                                 #    - Drag-and-drop zone
│   │   │                                 #    - OCR processing queue
│   │   │                                 #    - Review panel per screenshot
│   │   │                                 #    - Batch save button
│   │   │
│   │   ├── events/
│   │   │   ├── page.tsx                  # 📅 Events list page
│   │   │   │                             #    - All events with stats
│   │   │   │                             #    - Create new event modal
│   │   │   │                             #    - Delete event action
│   │   │   │
│   │   │   └── [id]/
│   │   │       └── page.tsx              # 📋 Event detail page
│   │   │                                 #    - Full governor list for event
│   │   │                                 #    - Sortable table
│   │   │                                 #    - Edit/delete entries
│   │   │                                 #    - Export CSV
│   │   │
│   │   ├── compare/
│   │   │   └── page.tsx                  # 📊 Comparison dashboard
│   │   │                                 #    - Event A vs Event B selectors
│   │   │                                 #    - Warrior Score leaderboard
│   │   │                                 #    - Delta table (sortable, searchable)
│   │   │                                 #    - Charts (bar, pie, radar)
│   │   │                                 #    - Export full report
│   │   │
│   │   ├── governors/
│   │   │   └── page.tsx                  # 👥 Governor roster
│   │   │                                 #    - Full member list
│   │   │                                 #    - Search/filter
│   │   │                                 #    - Click to expand timeline
│   │   │                                 #    - Growth line chart
│   │   │
│   │   └── api/                          # 🔌 API Routes (serverless functions)
│   │       │
│   │       ├── events/
│   │       │   ├── route.ts              #    GET: list events
│   │       │   │                         #    POST: create event
│   │       │   │
│   │       │   └── [id]/
│   │       │       └── route.ts          #    GET: event details
│   │       │                             #    DELETE: delete event + cascade
│   │       │
│   │       ├── governors/
│   │       │   ├── route.ts              #    GET: list governors (search, paginate)
│   │       │   │                         #    POST: create/upsert governor
│   │       │   │
│   │       │   └── [id]/
│   │       │       └── timeline/
│   │       │           └── route.ts      #    GET: governor's timeline
│   │       │
│   │       ├── snapshots/
│   │       │   ├── route.ts              #    GET: list snapshots (filter by event)
│   │       │   │                         #    POST: save single snapshot
│   │       │   │
│   │       │   └── batch/
│   │       │       └── route.ts          #    POST: save batch of snapshots
│   │       │
│   │       ├── screenshots/
│   │       │   └── upload/
│   │       │       └── route.ts          #    POST: upload to Vercel Blob
│   │       │
│   │       └── compare/
│   │           └── route.ts              #    GET: compare two events
│   │                                     #    Returns deltas + warrior scores
│   │
│   ├── components/                       # 🧩 Reusable UI components
│   │   │
│   │   ├── Navbar.tsx                    #    Top navigation bar
│   │   │                                 #    - Logo + app name
│   │   │                                 #    - Navigation links
│   │   │                                 #    - Mobile hamburger menu
│   │   │
│   │   ├── StatsCard.tsx                 #    Glassmorphism stat card
│   │   │                                 #    - Icon, label, value
│   │   │                                 #    - Hover lift animation
│   │   │
│   │   ├── DropZone.tsx                  #    File drag-and-drop area
│   │   │                                 #    'use client'
│   │   │                                 #    - Drag events handling
│   │   │                                 #    - File validation
│   │   │                                 #    - Visual feedback
│   │   │
│   │   ├── OcrReviewPanel.tsx            #    OCR results review
│   │   │                                 #    'use client'
│   │   │                                 #    - Cropped image preview
│   │   │                                 #    - Editable value fields
│   │   │                                 #    - Validation indicators
│   │   │                                 #    - Confirm/Edit/Skip actions
│   │   │
│   │   ├── EventSelector.tsx             #    Event dropdown picker
│   │   │                                 #    'use client'
│   │   │                                 #    - Fetches event list
│   │   │                                 #    - Optional "create new" button
│   │   │
│   │   ├── DeltaTable.tsx                #    Comparison data table
│   │   │                                 #    'use client'
│   │   │                                 #    - Sortable columns
│   │   │                                 #    - Search filter
│   │   │                                 #    - Color-coded deltas
│   │   │
│   │   ├── WarriorScoreCard.tsx          #    Individual warrior score display
│   │   │                                 #    'use client'
│   │   │                                 #    - Animated score bar
│   │   │                                 #    - Tier badge
│   │   │                                 #    - Score breakdown tooltip
│   │   │
│   │   ├── TierBadge.tsx                 #    Warrior tier badge
│   │   │                                 #    - Emoji + color + label
│   │   │                                 #    - Size variants
│   │   │
│   │   ├── Charts.tsx                    #    Recharts wrapper components
│   │   │                                 #    'use client'
│   │   │                                 #    - KillsBarChart
│   │   │                                 #    - TierPieChart
│   │   │                                 #    - GrowthLineChart
│   │   │                                 #    - PerformanceRadarChart
│   │   │
│   │   └── LoadingShimmer.tsx            #    Skeleton loading animation
│   │                                     #    - Card shimmer variant
│   │                                     #    - Table row shimmer variant
│   │
│   └── lib/                              # 📦 Shared utilities and business logic
│       │
│       ├── prisma.ts                     #    Prisma client singleton
│       │                                 #    - Prevents multiple instances in dev
│       │                                 #    - Exports: prisma
│       │
│       ├── utils.ts                      #    General utility functions
│       │                                 #    - formatNumber(n): "85,000,000" or "85M"
│       │                                 #    - formatDelta(n): "+5,000,000" or "-3M"
│       │                                 #    - serializeBigInt(obj): BigInt→string
│       │                                 #    - parseNumber(str): "85,000,000" → 85000000
│       │                                 #    - cn(...classes): class name merger
│       │
│       ├── warrior-score.ts              #    Warrior Score calculator
│       │                                 #    - calculateWarriorScores(deltas[])
│       │                                 #    - getWarriorTier(score)
│       │                                 #    - getTierConfig(tier)
│       │                                 #    - rankGovernors(results[])
│       │
│       └── ocr/                          #    OCR engine and utilities
│           │
│           ├── image-preprocessor.ts     #    Image preprocessing pipeline
│           │                             #    'use client' (Canvas API)
│           │                             #    - loadImage(file): File → HTMLImageElement
│           │                             #    - cropRegion(img, template): crop to stat area
│           │                             #    - preprocessForOCR(canvas): grayscale → binarize
│           │                             #    - CROP_REGIONS: percentage-based templates
│           │
│           ├── ocr-engine.ts             #    Tesseract.js wrapper
│           │                             #    'use client'
│           │                             #    - initializeWorker(): create & cache worker
│           │                             #    - recognizeNumber(img): OCR with digit whitelist
│           │                             #    - recognizeText(img): OCR for names
│           │                             #    - processScreenshot(file): full pipeline
│           │                             #    - terminateWorker(): cleanup
│           │
│           └── validators.ts             #    Data validation
│                                         #    - validateGovernorData(data): range checks
│                                         #    - crossReferenceCheck(data, prev): anomaly detection
│                                         #    - ValidationResult interface
│
├── .env.local                            # 🔒 Local environment variables (git ignored)
├── .env.example                          # 📋 Template for required env vars
├── .gitignore                            # 🚫 Git ignore rules
├── next.config.ts                        # ⚙️ Next.js configuration
├── package.json                          # 📦 Dependencies and scripts
├── tsconfig.json                         # ⚙️ TypeScript configuration
├── vercel.json                           # ⚙️ Vercel deployment config (optional)
└── README.md                             # 📖 Project README
```

---

## File Count Summary

| Category      | Files | Description                    |
|---------------|-------|--------------------------------|
| Documentation | 9     | Planning docs in /docs         |
| Pages         | 6     | Next.js pages/routes           |
| API Routes    | 8     | Serverless API endpoints       |
| Components    | 10    | Reusable UI components         |
| Library       | 5     | Business logic and utilities   |
| Config        | 6     | Build/deploy configuration     |
| **Total**     | **44**| Complete MVP file count        |

---

## Build Order (Recommended Implementation Sequence)

### Phase 1: Foundation
1. `package.json` + `tsconfig.json` — Project setup
2. `prisma/schema.prisma` — Database schema
3. `src/lib/prisma.ts` — Database client
4. `src/lib/utils.ts` — Utility functions
5. `next.config.ts` — Build config

### Phase 2: Styling & Layout
6. `src/app/globals.css` — Complete design system
7. `src/app/layout.tsx` — Root layout
8. `src/components/Navbar.tsx` — Navigation
9. `src/components/StatsCard.tsx` — Stat cards
10. `src/components/LoadingShimmer.tsx` — Loading states

### Phase 3: Core OCR Engine
11. `src/lib/ocr/image-preprocessor.ts` — Image pipeline
12. `src/lib/ocr/ocr-engine.ts` — Tesseract wrapper
13. `src/lib/ocr/validators.ts` — Validation rules

### Phase 4: API Layer
14. `src/app/api/events/route.ts` — Events CRUD
15. `src/app/api/governors/route.ts` — Governors CRUD
16. `src/app/api/snapshots/route.ts` — Snapshots CRUD
17. `src/app/api/snapshots/batch/route.ts` — Batch save
18. `src/app/api/screenshots/upload/route.ts` — Blob upload
19. `src/app/api/compare/route.ts` — Comparison engine

### Phase 5: Warrior Score
20. `src/lib/warrior-score.ts` — Score calculator

### Phase 6: Pages & Components
21. `src/app/page.tsx` — Dashboard
22. `src/app/upload/page.tsx` — Upload + OCR
23. `src/components/DropZone.tsx` — Drag-and-drop
24. `src/components/OcrReviewPanel.tsx` — OCR review
25. `src/app/events/page.tsx` — Events list
26. `src/app/events/[id]/page.tsx` — Event detail
27. `src/app/compare/page.tsx` — Comparison dashboard
28. `src/components/DeltaTable.tsx` — Delta table
29. `src/components/WarriorScoreCard.tsx` — Score cards
30. `src/components/Charts.tsx` — All charts
31. `src/app/governors/page.tsx` — Governor roster

### Phase 7: Polish & Deploy
32. `README.md` — Documentation
33. `.env.example` — Env template
34. `vercel.json` — Deploy config
35. Test and verify all features
