# Selection UX Improvements

## Overview

This spec identifies three concrete UX problems with the current selection system and proposes fixes. The goal is to align selection behaviour more closely with established notation editor conventions (Sibelius/Finale) and remove friction from common editing journeys.

---

## Problem 1 — Bar selection is unintuitive

### Current behaviour

Bar selection works in two phases:

1. **Phase 1**: Click empty space in a measure → selects all parts for that bar. Shift+click a later measure → extends range.
2. **Phase 2**: Once a range is active, click within a stave inside the range → *narrows* to that part only. Shift+click a different stave → *adds* that part.

**Why this is bad:**
- The behaviour of a click changes depending on whether an existing selection is present — Phase 1 and Phase 2 clicks look identical but do opposite things (extend vs narrow). Users have no affordance to know which phase they're in.
- "Shift+click beyond the range extends it; shift+click inside the range adds a part" is a hidden dual behaviour that is impossible to discover without reading documentation.
- The two-phase flow requires 4+ interactions for a simple cross-part selection (click bar 3 → shift+click bar 7 → click one part → shift+click another part). Sibelius does this in 2 (click first note → shift+click last note).
- There is no keyboard way to extend a bar selection once started.

### Proposed fix

Replace the two-phase model with a **single consistent interaction**, modelled on Sibelius's passage selection:

**A. Click to anchor:**
- Click empty space in a measure → selects that measure on the stave you clicked. That stave is the anchor.
- Click any empty space outside all staves → clears selection.

**B. Shift+click to extend:**
- Shift+click in any measure/stave → extends the selection to cover all measures between the anchor and the clicked measure, and all staves between the topmost and bottommost click points (inclusive).
- This handles both measure range and part range in a single gesture — identical to Sibelius.

**C. Keyboard extension:**
- When a bar selection is active, `←` / `→` shrink/extend the measure range by one measure at the end.
- `Shift+↑` / `Shift+↓` expand the stave coverage up or down by one part.

**Result:** The "phase 2 part narrowing via further clicks" concept is removed entirely. Part coverage is always determined by the top/bottom stave of the two click points.

**Visual change:** When a bar selection covers a subset of parts, the highlight rectangle should only span those staves (not fill the full system width). Currently it always spans the full system regardless of `partIds`, making part filtering invisible. This should be fixed as part of this change.

---

## Problem 2 — Voice 2 notes cannot be selected or edited

### Current behaviour

The note hit-detection in select mode reads from `voices[0]` unconditionally (`ScoreCanvas.tsx:3169`):

```typescript
const selVoice = selStaff.measures[selMIdx].voices[0]  // ← always voice 0
```

This means:
- Clicking anywhere in a measure in select mode only ever hits voice 1 (index 0) notes.
- Voice 2 notes are completely invisible to the hit-tester. A click near a voice 2 note falls through to the empty-space handler, starting an unwanted bar selection instead.
- There is no way to select, delete, change duration, or apply articulations to voice 2 content without switching to note input mode and overwriting it.
- The range-select (shift+click) collects events from all voices for the ID list, but since you can never anchor on a voice 2 note, the range always starts from voice 1.

### Why this is bad

Voice 2 (typically lower stems) is a core counterpoint feature. Once entered, its content is largely immutable from select mode — a user who needs to correct a voice 2 note must switch to note input mode and re-enter it rather than simply clicking and editing it.

### Proposed fix

**A. Hit-test all voices in the clicked stave:**
- Replace the hardcoded `voices[0]` lookup with a search across all voices in the measure, finding the closest event regardless of which voice it belongs to.
- Record the matched voice index alongside the event ID so downstream operations (cursor placement, copy, delete) know which voice they're acting on.

```typescript
// Pseudocode
let closest: { id: string; dist: number; noteX: number; voiceIndex: number } | null = null
for (let vi = 0; vi < measure.voices.length; vi++) {
  for (const ev of measure.voices[vi].events) {
    const noteX = notePositionsRef.current.get(ev.id)
    if (noteX === undefined) continue
    const dist = Math.abs(canvasX - noteX)
    if (!closest || dist < closest.dist) closest = { id: ev.id, dist, noteX, voiceIndex: vi }
  }
}
```

**B. Switch `activeVoice` on selection:**
- When a voice 2 note is selected by click, automatically update `activeVoice` to match. This keeps the toolbar voice indicator in sync and ensures subsequent note input enters the correct voice.
- When a voice 1 note is selected, `activeVoice` is set to 0 (same as today).

**C. Voice indicator in selection summary:**
- The context menu summary line currently shows e.g. `"Bar 3 · All parts"` for bar selections and a note's duration for note selections.
- When a voice 2 note is selected, append a small voice indicator (e.g. `"Quarter · V2"`) so users can confirm which voice they're editing.

**D. All note-level operations respect the voice:**
- Delete, duration change, articulation toggle, transpose — all already dispatch with an explicit `voiceId`. No command-level changes needed; only the hit-detection and cursor-tracking need updating.

---

## Problem 3 — Signature pickers conflict with selection

### Current behaviour

In select mode, click priority is:
1. Key signature (opens Circle-of-Fifths picker)
2. Time signature (opens time-sig picker)
3. Barline
4. Note head
5. Empty space (bar selection)

**Critically, steps 1–2 fire unconditionally** — regardless of whether the user has an active note selection, a bar selection, or nothing selected at all. Opening a key or time sig picker immediately calls `setSelectionMenuPos(null)`, destroying any existing selection and closing the context menu.

### Why this is bad

1. **Notes in the preamble zone are unselectable**: Key sig detection fires for any click in roughly the first 90 px of a system-start measure (`canvasX >= l.x && canvasX <= l.x + 90`), and note hit detection only runs *after* that check. A note that happens to render within this zone — common for the first note of a piece or after a long preamble — can never be selected by clicking it. The picker opens instead, with no visual indication that a note was there.

2. **Accidental dismissal with any selection active**: A user selects a note (or a passage), then clicks nearby to apply an operation. If the pointer lands in the preamble zone, a signature picker opens and silently wipes the existing selection. This affects both note selections and bar selections.

3. **Impossible to batch-change signatures**: A user selects bars 1–8 to change the key. Any click on the key signature in that range immediately cancels the selection and opens a single-measure picker instead. There is no way to set a key/time signature across a range of bars.

4. **Context menu Key/Time tabs disabled for multi-bar**: The context menu disables Time and Key tabs for any selection spanning more than one bar, reinforcing this as a dead end. The most natural workflow — select a range, open context menu, change key — is blocked at both the click level and the menu level.

### Proposed fix

**A. Run note hit-detection before signature zone checks:**
- Move the note hit-test to the top of the click priority chain, before key sig and time sig zone checks.
- If a note is found within hit distance (≤ 20 px), select it immediately and skip all signature picker logic — regardless of where on the measure the note happens to sit.
- Signature pickers remain reachable by clicking the signature glyphs directly when no note is nearby; the hit radius for note selection (20 px) is tight enough that this is unambiguous in practice.
- This fixes the "first note of the piece is unselectable" class of bugs entirely.

**B. Suppress signature pickers when any selection is active:**
- When `selectedNoteIds.length > 0` OR `barSelection !== null`, clicks in the key/time sig preamble zone do **not** open pickers. The click falls through to the normal selection logic (extend, note-hit, or empty space).
- This prevents the "you already have something selected but lose it by clicking nearby" problem for both note selections and bar selections.
- Users who *want* to open a signature picker while something is selected can press Escape first to clear the selection, then click the signature.

**C. Signature changes via context menu apply to the full selected range:**
- Enable the **Key** and **Time** tabs in the context menu for all bar selections (currently disabled for multi-bar).
- When applied with a passage selected, the key/time change is inserted at `startMeasureIndex` and any conflicting per-measure overrides within the range are removed, so the signature is uniform across the passage.
- For key changes spanning transposing parts, the change is applied relative to each part's transposition offset (written key), not as an absolute concert key.

**D. Hover affordance for signature click zones (optional polish):**
- When no selection is active, show a subtle highlight or cursor change (e.g. `pointer` cursor + faint underline on the signature glyph) on hover to signal that clicking will open a picker.
- Without hover, the preamble area is visually inert, reducing accidental activations even without a selection.
- This is low priority and can ship separately.

---

## Summary of Changes

| # | Change | Files affected |
|---|--------|----------------|
| 1a | Replace phase 1/2 bar selection with anchor+shift+click passage model | `ScoreCanvas.tsx` (click handler), `appStore.ts` (setBarSelection) |
| 1b | Bar selection highlight only spans selected stave range (not full system) | `notationRenderer.ts` (drawOverlay) |
| 1c | Add `←`/`→`/`Shift+↑`/`Shift+↓` keyboard extension for bar selections | `ScoreCanvas.tsx` (keydown handler) |
| 2a | Hit-test all voices in select mode, not just `voices[0]` | `ScoreCanvas.tsx:3169` |
| 2b | Sync `activeVoice` to the voice of the clicked note | `ScoreCanvas.tsx` (click handler → setActiveVoice) |
| 2c | Voice indicator in selection context menu summary | `ScoreCanvas.tsx` (context menu summary) |
| 3a | Move note hit-detection before key/time sig zone checks in click priority | `ScoreCanvas.tsx` (click handler, reorder checks ~3058–3178) |
| 3b | Suppress key/time sig pickers when any selection (note or bar) is active | `ScoreCanvas.tsx` (click priority logic, lines ~3058–3134) |
| 3c | Enable Key/Time context menu tabs for multi-bar selections; apply to full range | `ScoreCanvas.tsx` (context menu), `appStore.ts` (SET_KEY / SET_TIME dispatch) |

---

## Interaction examples (post-fix)

**Select and delete a voice 2 note:**
1. Click on a voice 2 note → selects it; activeVoice updates to 1; context menu shows `"Quarter · V2"`
2. Press Delete → note replaced with rest in voice 2

**Edit a voice 2 note's duration:**
1. Click the voice 2 note → selected, activeVoice = 1
2. Press `3` (eighth note) → duration updated in voice 2

**Select bars 3–7, all parts, and transpose up a fifth:**
1. Click empty space in bar 3 (any stave) → passage selection anchors on that stave
2. Shift+click empty space in bar 7, lowest part → extends to bars 3–7, spanning all staves between
3. Context menu → Transpose tab → apply P5

**Select bars 3–7, piano only (two staves), and copy:**
1. Click empty space in bar 3 on piano treble stave
2. Shift+click empty space in bar 7 on piano bass stave → bars 3–7, treble+bass only
3. Cmd+C

**Change key signature from bar 5 to end of score:**
1. Click empty space in bar 5 → selects bar 5, all parts
2. Shift+click empty space in final bar → extends selection to end
3. Context menu → Key tab → select new key → Apply (applies key change at bar 5, removes any intermediate overrides)

**Select the first note of a piece (preamble zone overlap):**
- User clicks on the first note of the score, which renders within the key/time sig preamble area → note is selected (note hit-test runs first); key sig picker does NOT open.

**Avoid accidental signature picker with a note selected:**
- User has a note selected; clicks near the time signature at the system start → picker does NOT open (selection is active); the click is treated as a note-hit or empty-space click instead.
- To change the time sig: press Escape (clears selection) then click the time signature.

---

## Out of scope

- Click-drag box selection (deferred per multi-select.md)
- OS clipboard integration
- Selection persistence across undo/redo (existing behaviour unchanged)
