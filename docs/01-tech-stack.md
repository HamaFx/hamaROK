# Tech Stack — Detailed Decisions

## Summary Table

| Layer            | Technology              | Version  | Why Chosen                                    |
|------------------|-------------------------|----------|-----------------------------------------------|
| Framework        | Next.js (App Router)    | 15.x     | Full-stack, Vercel-native, SSR + CSR           |
| Language         | TypeScript              | 5.x      | Type safety for OCR data pipelines             |
| Database         | Vercel Postgres (Neon)  | —        | Free tier, zero config, auto-provisioned       |
| ORM              | Prisma                  | 6.x      | Type-safe queries, migrations, Vercel compat   |
| OCR              | Tesseract.js            | 5.x      | Free, client-side, no API keys                 |
| Image Storage    | Vercel Blob             | —        | Native integration, stores audit screenshots   |
| Charts           | Recharts                | 2.x      | React-native, responsive, lightweight          |
| Styling          | Vanilla CSS             | —        | Full control, CSS variables, no framework bloat|
| Font             | Google Fonts            | —        | Rajdhani (headings) + Inter (body)             |
| Deployment       | Vercel                  | —        | Auto-deploy from GitHub, edge network          |

---

## Detailed Rationale

### Next.js 15 (App Router)

**Why not a SPA (React + Vite)?**
- We need server-side API routes for database operations
- Server Components reduce client bundle size (important for mobile)
- Built-in image optimization via `next/image`
- Vercel deploys Next.js with zero configuration

**Why not a separate backend (Express/Fastify)?**
- Adds complexity: two repos, two deployments, CORS config
- Vercel serverless functions handle our load perfectly
- Next.js API routes give us everything we need

**App Router vs Pages Router?**
- App Router is the modern standard (stable since Next.js 13.4)
- Server Components by default = better performance
- Layouts, loading states, and error boundaries built-in

---

### TypeScript

**Why TypeScript over JavaScript?**
- OCR data pipelines involve complex data transformations
- Type safety catches bugs early (e.g., `BigInt` vs `number` for power values)
- Prisma generates TypeScript types from the schema automatically
- Better developer experience with IDE autocompletion

---

### Vercel Postgres (Neon)

**Why a relational database?**
- Our data is inherently relational: Governors → Snapshots → Events
- SQL queries for comparisons and aggregations are natural
- JOINs to link governors, snapshots, and events

**Why not MongoDB/Firestore?**
- Relational data doesn't map well to documents
- SQL aggregation (SUM, AVG, GROUP BY) is critical for analytics
- No benefit from schema flexibility — our schema is well-defined

**Why not Supabase?**
- Vercel Postgres is native to the deployment platform
- One fewer account/service to manage
- Environment variables auto-injected

**Free Tier Limits:**
| Resource         | Limit        | Our Usage Estimate          |
|------------------|--------------|-----------------------------|
| Storage          | 256 MB       | ~5 MB/year for 100 players  |
| Compute          | 60 hrs/month | ~2 hrs/month estimated      |
| Branching        | 1 branch     | Sufficient for MVP          |

---

### Prisma ORM

**Why an ORM at all?**
- Raw SQL is error-prone with BigInt values and complex JOINs
- Prisma generates type-safe client from schema
- Migrations track schema changes over time
- Works seamlessly with Vercel Postgres

**Key Prisma Features We Use:**
- `@default(cuid())` for auto-generated IDs
- `BigInt` type for game stat values (some kill counts exceed `Number.MAX_SAFE_INTEGER`)
- `@@unique` compound constraints for data integrity
- Relation fields for Governor ↔ Snapshot ↔ Event

---

### Tesseract.js v5 (Client-Side OCR)

**Why client-side instead of server-side?**
- **Zero compute costs**: OCR runs in the user's browser
- **No file upload for OCR**: Screenshots processed locally, only results sent to server
- **Privacy**: Screenshots never leave the device unless user chooses to save them
- **Scalability**: Supports any number of concurrent users without server load

**Why not Google Cloud Vision API?**
- Costs money per request (~$1.50 per 1000 images)
- Requires API key management
- Overkill for structured UI screenshots with predictable layouts
- Region cropping + digit whitelist achieves comparable accuracy for free

**Why not server-side Tesseract?**
- Vercel serverless functions have a 10-second timeout (free tier)
- OCR processing can take 5-15 seconds per image
- Client-side has no timeout constraints

**Performance Considerations:**
- First load: ~5 MB WASM binary download (cached after first load)
- Processing speed: ~2-5 seconds per screenshot
- Worker reuse: Single worker handles multiple images sequentially

---

### Vercel Blob

**Why store screenshots?**
- **Audit trail**: Verify OCR results against original images
- **Re-processing**: If OCR improves, re-run on stored images
- **Dispute resolution**: Prove stats to alliance members

**Free Tier Limits:**
| Resource    | Limit           |
|-------------|-----------------|
| Storage     | 1 GB            |
| Reads       | Unlimited       |
| Writes      | 1000/day        |

**Storage Estimate:**
- Average RoK screenshot: ~300 KB (compressed)
- 100 players × 2 snapshots/month = 200 images = ~60 MB/month
- 1 GB supports ~16 months of data

---

### Recharts

**Why Recharts over Chart.js?**
- React-native components (JSX, not imperative canvas API)
- `ResponsiveContainer` handles responsive layouts automatically
- Easier to style with our CSS theme
- Smaller bundle size than Chart.js with React wrapper

**Chart Types We'll Use:**
| Chart Type    | Purpose                                    |
|---------------|--------------------------------------------|
| BarChart      | Kill point deltas leaderboard              |
| RadarChart    | Balanced performance profile per governor  |
| LineChart     | Power growth over time (timeline view)     |
| PieChart      | Warrior tier distribution                  |

---

### Vanilla CSS (No Tailwind)

**Why not Tailwind CSS?**
- We want a cohesive, custom gaming aesthetic (not generic utility classes)
- CSS variables power our theme system (easy dark mode, color schemes)
- Glassmorphism and complex gradients are cleaner in vanilla CSS
- No build-time dependency or config overhead

**Design System:**
```css
/* Our CSS variable theme */
--color-bg-primary:    #0a0e1a;     /* Deep space navy */
--color-bg-secondary:  #111827;     /* Card backgrounds */
--color-bg-glass:      rgba(17, 24, 39, 0.6);
--color-accent-gold:   #f59e0b;     /* RoK gold */
--color-accent-purple: #8b5cf6;     /* Elite warrior */
--color-accent-blue:   #3b82f6;     /* Frontline */
--color-text-primary:  #f1f5f9;     /* Bright white */
--color-text-secondary:#94a3b8;     /* Muted gray */
--color-success:       #10b981;     /* Positive deltas */
--color-danger:        #ef4444;     /* Negative deltas */
```

---

## Dependencies (package.json)

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@prisma/client": "^6.0.0",
    "@vercel/blob": "^0.25.0",
    "@vercel/postgres": "^0.10.0",
    "tesseract.js": "^5.0.0",
    "recharts": "^2.12.0"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "typescript": "^5.0.0",
    "@types/react": "^19.0.0",
    "@types/node": "^20.0.0"
  }
}
```

---

## Alternatives Considered & Rejected

| Alternative         | Why Rejected                                             |
|---------------------|----------------------------------------------------------|
| Discord Bot         | Poor UX for batch uploads and data review                |
| Desktop App (Electron)| Requires download, no mobile access, harder to deploy |
| Python + Flask      | Separate frontend needed, more complex deployment        |
| Firebase            | NoSQL not ideal for relational snapshot data             |
| AWS S3 + Lambda     | Overengineered for MVP, more complex than Vercel         |
| Cloudflare Workers  | Less mature database/blob integrations                   |
