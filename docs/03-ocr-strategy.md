# OCR Strategy — Solving the Screenshot Challenge

## The Challenge

Rise of Kingdoms has **no public API**. The only way to get player stats is to read them visually from the "Governor More Info" screen. This screen contains:

- **Governor ID** (top area, numeric)
- **Governor Name** (top area, text)
- **Power** (large number, center)
- **Kill Points** (in the kills section)
- **T4 Kills** / **T5 Kills** (sub-sections)
- **Dead Troops** (bottom section)

### Known OCR Difficulties with RoK:
1. **Custom game font** — numbers like 1 and 7 can look similar
2. **Comma-separated numbers** — "1,234,567" must parse correctly
3. **White/yellow text on dark background** — inverted from what Tesseract expects
4. **Variable screenshot resolutions** — phones, tablets, emulators all differ
5. **Localization artifacts** — UI elements may shift slightly between devices

---

## 3-Layer Accuracy Pipeline

```
                    ┌─────────────────────┐
                    │   LAYER 1           │
                    │   Image             │
Screenshot ───────▶│   Preprocessing     │──────▶ Clean, high-contrast crops
                    │   (Canvas API)      │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   LAYER 2           │
                    │   Constrained       │
Clean crops ──────▶│   Tesseract OCR     │──────▶ Raw extracted values
                    │   (Digit whitelist) │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   LAYER 3           │
                    │   Validation &      │
Raw values ───────▶│   Human Review      │──────▶ Verified, clean data
                    │   (UI + Algorithms) │
                    └─────────────────────┘
```

---

## Layer 1: Image Preprocessing

### Step-by-Step Pipeline

```
Raw Screenshot
    │
    ├── 1. Load into HTML Canvas
    │
    ├── 2. Crop to specific region (Power, Kills, etc.)
    │       └── Using percentage-based coordinates
    │
    ├── 3. Convert to Grayscale
    │       └── R*0.299 + G*0.587 + B*0.114
    │
    ├── 4. Invert Colors (if light text on dark bg)
    │       └── 255 - pixel_value
    │
    ├── 5. Apply Threshold Binarization
    │       └── pixel > 128 ? 255 : 0
    │
    ├── 6. Scale up 2x
    │       └── Small numbers are unreadable at native size
    │
    └── 7. Export as PNG DataURL
            └── Feed to Tesseract
```

### Region Crop Templates

The "Governor More Info" screen has a **consistent layout** across all devices. We define crop regions as **percentage-based coordinates** relative to the screenshot dimensions:

```typescript
// Region templates (percentage-based for resolution independence)
const CROP_REGIONS = {
  governorId: {
    x: 0.30,    // 30% from left
    y: 0.08,    // 8% from top
    width: 0.40, // 40% of image width
    height: 0.04 // 4% of image height
  },
  governorName: {
    x: 0.25,
    y: 0.12,
    width: 0.50,
    height: 0.05
  },
  power: {
    x: 0.30,
    y: 0.22,
    width: 0.40,
    height: 0.05
  },
  killPoints: {
    x: 0.50,
    y: 0.42,
    width: 0.45,
    height: 0.04
  },
  t4Kills: {
    x: 0.50,
    y: 0.54,
    width: 0.45,
    height: 0.04
  },
  t5Kills: {
    x: 0.50,
    y: 0.58,
    width: 0.45,
    height: 0.04
  },
  deads: {
    x: 0.50,
    y: 0.72,
    width: 0.45,
    height: 0.04
  }
};
```

> **Note**: These coordinates are estimates. During development, we'll calibrate them with real screenshots and provide a "Region Calibration" tool in the UI where users can adjust crop regions visually.

### Canvas Preprocessing Code

```typescript
function preprocessForOCR(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Step 1: Grayscale
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
    data[i] = data[i+1] = data[i+2] = gray;
  }

  // Step 2: Invert (RoK uses light text on dark bg)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i+1] = 255 - data[i+1];
    data[i+2] = 255 - data[i+2];
  }

  // Step 3: Binarize (threshold at 128)
  for (let i = 0; i < data.length; i += 4) {
    const val = data[i] > 128 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = val;
  }

  ctx.putImageData(imageData, 0, 0);

  // Step 4: Scale 2x
  const scaled = document.createElement('canvas');
  scaled.width = canvas.width * 2;
  scaled.height = canvas.height * 2;
  const sCtx = scaled.getContext('2d')!;
  sCtx.imageSmoothingEnabled = false;  // Nearest-neighbor for crisp edges
  sCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height);

  return scaled;
}
```

---

## Layer 2: Constrained Tesseract OCR

### Configuration

```typescript
import { createWorker } from 'tesseract.js';

// Initialize worker once, reuse for all images
const worker = await createWorker('eng');

// For NUMERIC fields (Power, Kills, Deads, Governor ID)
await worker.setParameters({
  tessedit_char_whitelist: '0123456789,.',
  tessedit_pageseg_mode: '7',  // Single text line
});
const numericResult = await worker.recognize(processedCanvas);

// For TEXT fields (Governor Name)
await worker.setParameters({
  tessedit_char_whitelist: '',  // Allow all characters
  tessedit_pageseg_mode: '7',
});
const textResult = await worker.recognize(processedCanvas);
```

### Why This Works for the 1/7 Problem

When `tessedit_char_whitelist` is set to `'0123456789,.'`:
- Tesseract **only considers digits** as possible outputs
- The ambiguity between "1" and "7" is resolved by the engine's own glyph confidence
- Letters like "O" (which could be confused with "0") are excluded entirely
- Commas and periods are included for number formatting

### Worker Lifecycle

```
App Start
    │
    ├── Create Tesseract Worker (once)
    │       └── Downloads ~5MB WASM binary (cached by browser)
    │
    ├── Process screenshot 1
    │       ├── Crop region 1 → OCR → Power
    │       ├── Crop region 2 → OCR → Kill Points
    │       ├── Crop region 3 → OCR → T4 Kills
    │       ├── Crop region 4 → OCR → T5 Kills
    │       ├── Crop region 5 → OCR → Deads
    │       ├── Crop region 6 → OCR → Governor ID
    │       └── Crop region 7 → OCR → Governor Name
    │
    ├── Process screenshot 2 (reuse same worker)
    │       └── ... same regions ...
    │
    └── App Close → Terminate Worker
```

---

## Layer 3: Validation & Human Review

### Automated Validation Rules

```typescript
interface ValidationResult {
  field: string;
  value: string;
  isValid: boolean;
  confidence: number;
  warning?: string;
}

function validateGovernorData(data: RawOCRData): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Rule 1: Governor ID must be 6-12 digits
  results.push({
    field: 'governorId',
    value: data.governorId,
    isValid: /^\d{6,12}$/.test(data.governorId),
    confidence: data.governorIdConfidence,
    warning: /^\d{6,12}$/.test(data.governorId) ? undefined : 'Invalid ID format'
  });

  // Rule 2: Power must be between 1M and 2B
  const power = parseNumber(data.power);
  results.push({
    field: 'power',
    value: data.power,
    isValid: power >= 1_000_000 && power <= 2_000_000_000,
    confidence: data.powerConfidence,
    warning: power < 1_000_000 ? 'Power seems too low' : 
             power > 2_000_000_000 ? 'Power seems too high' : undefined
  });

  // Rule 3: Kill Points >= T4 Kills + T5 Kills (sanity check)
  const kills = parseNumber(data.killPoints);
  const t4 = parseNumber(data.t4Kills);
  const t5 = parseNumber(data.t5Kills);
  if (kills < t4 + t5) {
    results.push({
      field: 'killPoints',
      value: data.killPoints,
      isValid: false,
      confidence: data.killPointsConfidence,
      warning: 'Kill points less than T4+T5 sum — likely OCR error'
    });
  }

  // Rule 4: Values shouldn't decrease vs previous snapshot
  // (handled separately with cross-reference check)

  return results;
}
```

### Cross-Reference Check

If the governor already has a previous snapshot, we compare:

```typescript
function crossReferenceCheck(
  newData: ParsedOCRData,
  previousSnapshot: Snapshot | null
): Warning[] {
  if (!previousSnapshot) return [];
  
  const warnings: Warning[] = [];

  // Power shouldn't drop more than 50%
  if (newData.power < previousSnapshot.power * 0.5) {
    warnings.push({
      level: 'error',
      message: `Power dropped by ${formatDelta(newData.power - previousSnapshot.power)}. Verify screenshot.`
    });
  }

  // Kill points should never decrease
  if (newData.killPoints < previousSnapshot.killPoints) {
    warnings.push({
      level: 'error',
      message: `Kill points decreased — impossible. OCR likely misread.`
    });
  }

  // Dead troops should never decrease
  if (newData.deads < previousSnapshot.deads) {
    warnings.push({
      level: 'error',
      message: `Dead count decreased — impossible. OCR likely misread.`
    });
  }

  return warnings;
}
```

### Human Review UI

After OCR processing, the user sees a **review panel** for each screenshot:

```
┌─────────────────────────────────────────────────────┐
│  Screenshot: governor_45678901.png                   │
│                                                       │
│  ┌──────────┐  Governor ID:  [45678901   ] ✅        │
│  │ Cropped   │  Name:        [HamaWarlord ] ✅        │
│  │ Region    │  Power:       [85,000,000  ] ✅        │
│  │ Preview   │  Kill Points: [150,000,000 ] ✅        │
│  │           │  T4 Kills:    [45,000,000  ] ✅        │
│  │           │  T5 Kills:    [12,000,000  ] ✅        │
│  │           │  Deads:       [30,000,000  ] ✅        │
│  └──────────┘                                         │
│                                                       │
│  OCR Confidence: 94%  │  ⚠️ No warnings              │
│                                                       │
│  [✅ Confirm & Save]  [✏️ Edit Values]  [❌ Skip]     │
└─────────────────────────────────────────────────────┘
```

- Green checkmark (✅) = passed all validation rules
- Yellow warning (⚠️) = value seems unusual, review recommended
- Red error (❌) = failed validation, must be corrected before saving
- Each field is editable — click to type the correct value
- Cropped region image shown next to each field for visual comparison

---

## Accuracy Estimates

| Layer               | Accuracy       | What It Catches                        |
|---------------------|----------------|----------------------------------------|
| Preprocessing alone | ~85%           | Most digits correctly identified       |
| + Digit whitelist   | ~95%           | Eliminates letter confusion (O/0, l/1) |
| + Validation rules  | ~98%           | Catches impossible values              |
| + Human review      | ~99.9%         | User verifies every entry              |

---

## Future Improvements (Post-MVP)

1. **Custom-trained Tesseract model**: Train on the specific RoK font for near-perfect accuracy
2. **Template matching with OpenCV.js**: For the predictable digit font, template matching could be faster and more accurate
3. **Region auto-detection**: Use edge detection to auto-find stat fields instead of hardcoded coordinates
4. **Batch confidence threshold**: Auto-accept entries with >98% confidence, only show review for lower confidence
