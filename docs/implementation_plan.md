# OCR System Upgrade — Comprehensive Accuracy Overhaul

## Problem Statement

The current OCR engine uses **Tesseract.js** (client-side) for all text recognition on ranking leaderboard screenshots and governor profile screenshots. After deep analysis of the full pipeline ([ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts), [image-preprocessor.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/image-preprocessor.ts), [field-config.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/field-config.ts), [alliances.ts](file:///home/ubuntu/hamaROK/src/lib/alliances.ts)), I've identified **8 root-cause failure modes** responsible for OCR inaccuracies.

---

## Root Cause Analysis

### 1. 🔴 Name Whitelist Too Restrictive
The Tesseract whitelist for ranking names is:
```
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 []()_#.-:+/\\|*
```
**Missing characters**: `'` (apostrophe in `[V'57]`), `` ` `` (backtick in `V\`57`), `,`, `&`, `!`, `?`, `@`, `"`. This forces Tesseract to substitute with wrong characters, corrupting names.

### 2. 🔴 Preprocessing Ignores Color Information
The ranking boards are **white text on a bright cyan/blue background**. The current pipeline converts to grayscale using standard luminance weights (R×0.299 + G×0.587 + B×0.114), which produces **very poor contrast** between white text and the cyan background. A blue-channel-aware extraction would dramatically improve text separation.

### 3. 🔴 Name Crop Region Too Narrow
`nameMainRegion.x = 0.265` clips into the avatar circle area, sometimes catching avatar edges. Names with long alliance tags like `[V'57] Monkey D Luffie` need to start earlier. The width at `0.405` also truncates long names.

### 4. 🟡 Superscript Alliance Tags Are Lost
In the actual screenshots, alliance tags (e.g., `Gd`, `GOD`) appear as **tiny superscript text** above/before the governor name. Tesseract at the default scale cannot read these. A dedicated high-zoom pass for the left portion of the name region would capture them.

### 5. 🟡 No Comma-Aware Metric Parsing  
RoK metrics display as `54,268,607`. The comma is sometimes OCR'd as `.`, `'`, or a space. The current `normalizeMetricDigits` strips everything non-digit but doesn't validate comma-position plausibility, so `54268607` and `5426867` (a dropped digit) look equally valid.

### 6. 🟡 Metric Monotonicity Not Enforced
For Individual Power rankings, values should be **strictly non-increasing** (rank 1 has highest power). The system doesn't leverage this invariant to detect and correct single-row errors.

### 7. 🟠 Rank Digit Confusion on Medal Rows
Positions 1-3 have decorative **gold/silver/bronze medal overlays** around the rank number. Tesseract struggles to isolate the actual digit from the medal art. The current `rankRegion.x = 0.176` crops too wide, catching medal edges.

### 8. 🟠 Profile Screenshot Governor Name Length Cap Too Short
`sanitizeGovernorName` hard-caps at **30 characters**. RoK names can be up to 25 chars, but with alliance tags like `[GODt] ` prepended by the OCR, the total can exceed 30 and get truncated.

---

## Proposed Changes

### A. Image Preprocessing — Color-Aware Pipeline

#### [MODIFY] [image-preprocessor.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/image-preprocessor.ts)

- **Add `extractTextChannel()` function**: A new preprocessing step specifically for ranking boards. Instead of standard grayscale, it will:
  - Detect if the image has a dominant blue/cyan background (hue 170-210°)
  - If detected, extract using **inverted blue-weighted channels**: emphasize where white text contrasts against blue
  - Apply a saturation-based mask to eliminate the colored background entirely
  - Result: near-perfect black text on white background for Tesseract

- **Add `sharpenKernel()` step**: Apply an unsharp-mask pass (OpenCV `filter2D`) before thresholding to restore game-font sharp edges that get blurred during screenshot compression.

---

### B. Name Detection Overhaul

#### [MODIFY] [ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts) — `recognizeRankingField` and pass plans

1. **Expand name whitelist** to include all characters that appear in RoK names:
   ```
   ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 []()_#.'-:+/\\|*&!?@",`~^
   ```

2. **Add a 4th high-zoom name pass** (scale 3.0) targeting just the left 40% of the name region to capture superscript alliance tags.

3. **Add a "name cleanup" post-processor** that:
   - Strips known OCR garbage patterns (e.g., `|||`, `---`, `***`)
   - Normalizes common OCR confusions in names (e.g., `l` vs `I`, `0` vs `O` — but **only** when the character appears in a context that suggests it's wrong)
   - Preserves legitimate special characters

4. **Widen the name crop region**: Move `nameMainRegion.x` from `0.265` → `0.255` and widen `width` from `0.405` → `0.42`.

5. **Increase name max length**: From 64 → 80 chars in `normalizeRankingName`, and from 30 → 40 chars in `sanitizeGovernorName`.

---

### C. Metric Number Accuracy

#### [MODIFY] [ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts) — ranking row processing

1. **Add comma-position validation**: After extracting digits, check if the original OCR text had comma-like separators. If commas are present, validate that digit groups follow the `N,NNN,NNN` pattern. If not, flag as low-confidence.

2. **Add monotonicity guard** for Individual Power rankings: After all rows are parsed, verify values are non-increasing. If a single row violates monotonicity, mark it as low-confidence and attempt correction from adjacent rows.

3. **Add digit-count plausibility check**: For `individual_power`, all values in a single screenshot should have similar digit counts (±1). An outlier likely has a dropped or extra digit.

---

### D. Rank Number Improvements

#### [MODIFY] [ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts) — `rankRegion` and rank processing

1. **Tighten rank crop region**: Shift `rankRegion.x` from `0.176` → `0.19` and narrow width from `0.09` → `0.07` to avoid medal edges.

2. **Add sequential rank validation**: After initial OCR, verify that ranks form a contiguous sequence (e.g., 1,2,3,4,5,6). If there's a gap or duplicate, infer the correct rank from context.

---

### E. Layout Detection Improvements

#### [MODIFY] [ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts) — `buildRankingLayoutCandidates`

1. **Add more Y-start candidates**: Expand from 3 to 5 start positions to handle more device notch sizes and status bar heights.
2. **Add more row-step candidates**: Include `0.098` and `0.12` for edge cases with non-standard UI scaling.

---

### F. Governor Name Length in field-config

#### [MODIFY] [field-config.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/field-config.ts)

- Increase `TEXT_ALLOWED` max from 30 to 40 characters.

---

### G. Alliance Detection — V'57 Backtick Pattern

#### [MODIFY] [alliances.ts](file:///home/ubuntu/hamaROK/src/lib/alliances.ts)

- Add `"V'57"`, `"V\`57"`, `"[V'57]"`, `"[V\`57]"` to the V57 alliance aliases to handle the backtick/apostrophe variants that appear in-game.

---

## Files Summary

| File | Change Type | Impact |
|---|---|---|
| [image-preprocessor.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/image-preprocessor.ts) | MODIFY | Color-aware text extraction, sharpening |
| [ocr-engine.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/ocr-engine.ts) | MODIFY | Name whitelist, crop regions, passes, guards |
| [field-config.ts](file:///home/ubuntu/hamaROK/src/lib/ocr/field-config.ts) | MODIFY | Name length cap increase |
| [alliances.ts](file:///home/ubuntu/hamaROK/src/lib/alliances.ts) | MODIFY | V'57 alias coverage |

---

## Verification Plan

### Automated
- Run `npx tsc --noEmit` to verify type safety after all changes.

### Manual
- Process the 4 example screenshots (`IMG_7131.PNG` through `IMG_7134.PNG`) through the OCR flow
- Verify that names like `Monkey D Luffie`, `✕ PAINNN`, `Gd Shanks`, `GdMarshall`, `SanSenEL` are detected correctly
- Verify that metric values match the visible numbers in screenshots
- Verify that rank numbers 1-6 are correctly detected despite medal overlays

> [!IMPORTANT]
> This is a **preprocessing and post-processing upgrade** — no model retraining is required. All changes are to the code that feeds Tesseract and validates its output. The improvements compound: better preprocessing → cleaner input to Tesseract → higher raw confidence → fewer fallback invocations.
