# RoK Command Center — Project Overview

## What Is This?

**RoK Command Center** is a web-based Alliance Management Tool for *Rise of Kingdoms*. Since the game has no public API, this tool relies on **screenshot analysis via OCR** to extract player statistics and track alliance performance over time.

## The Problem

Alliance leaders need to:
- Track 100+ players' growth and KvK contribution
- Compare stats at different points in time (start vs end of KvK)
- Identify top performers and inactive players
- Do all of this **manually** using spreadsheets — which takes hours

## The Solution

A premium web app that:
1. **Accepts batch screenshots** of the "Governor More Info" screen
2. **Extracts stats automatically** via OCR (Power, Kill Points, T4/T5 Kills, Deads)
3. **Saves snapshots** as "Points in Time" (e.g., KvK Start, KvK End)
4. **Compares snapshots** to calculate deltas (actual progress)
5. **Ranks members** using a custom "Warrior Score" formula
6. **Visualizes performance** with charts and leaderboards

## Core Workflow

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Upload      │────▶│  OCR Engine   │────▶│  Review &    │────▶│  Save to     │
│  Screenshots │     │  Extracts     │     │  Correct     │     │  Snapshot     │
│  (Batch)     │     │  Stats        │     │  Values      │     │  (Event)      │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                       │
                                                                       ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Warrior     │◀────│  Calculate   │◀────│  Compare     │◀────│  Select Two  │
│  Score       │     │  Deltas      │     │  Snapshots   │     │  Events      │
│  Leaderboard │     │  (A vs B)    │     │              │     │              │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

## Target Users

- **Alliance Leaders (R4/R5)** — Primary users who manage the alliance
- **Officers** — Secondary users who help track KvK participation
- **Members** — View-only access to see their own stats and rankings

## Key Design Principles

1. **Accuracy over speed** — OCR results must be verifiable before saving
2. **Zero API dependency** — Everything works from screenshots
3. **Minimal setup** — No login required for MVP; share via link
4. **Mobile-friendly** — Leaders often manage from their phones
5. **Free to host** — Vercel free tier supports the full stack
