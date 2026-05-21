# Stave Grouping — Brackets, Braces & Spanning Barlines

## Overview

Parts in a score can be visually grouped using a bracket or brace drawn on the left side of
each system, with barlines that span vertically across all staves in the group.

This matches standard engraving conventions:
- **Bracket `[`** — used for instrument family groups (strings, woodwinds, brass, etc.)
- **Brace `{`** — used for grand-staff instruments (piano, organ, harp)

---

## Data model

`Part` carries two new optional fields:

| Field | Type | Description |
|---|---|---|
| `groupId` | `string \| undefined` | Parts sharing the same `groupId` form one group. Undefined = no group. |
| `groupSymbol` | `'bracket' \| 'brace' \| undefined` | Visual symbol drawn for this group. Should be the same for all parts in a group. |

Groups are **peer-to-peer**: there is no separate Group entity. Parts are ordered by their
position in `score.parts`; the first part in the array is the top of the group, the last is
the bottom.

---

## MusicXML import

`<part-group>` elements in `<part-list>` are parsed to assign groups automatically.

```xml
<part-list>
  <part-group type="start" number="1">
    <group-symbol>bracket</group-symbol>    <!-- or "brace" -->
  </part-group>
  <score-part id="P1">…</score-part>
  <score-part id="P2">…</score-part>
  <part-group type="stop" number="1"/>
</part-list>
```

- Each `part-group` start creates a unique `groupId` (UUID).
- `<group-symbol>bracket</group-symbol>` → `groupSymbol: 'bracket'`
- `<group-symbol>brace</group-symbol>` → `groupSymbol: 'brace'`
- Unknown or absent symbols default to `'bracket'`.
- Parts not inside a `<part-group>` receive no `groupId` and render without a connector.
- Nested part-groups are partially supported: each part receives the first active group.

---

## Rendering

`drawGroupConnectors` runs after all staves are drawn, using VexFlow `StaveConnector`.

At each **line start** (first measure on a system line):
1. `BRACKET` or `BRACE` connector drawn on the left spanning the group.
2. `SINGLE_LEFT` connector fills the gap between adjacent staves' left barlines.

At every **measure column**:
- `SINGLE_RIGHT` connector fills the gap between adjacent staves' right barlines.
- Upgraded to `BOLD_DOUBLE_RIGHT` for final/repeat-end barlines.
- Upgraded to `THIN_DOUBLE` for double barlines.

---

## Group assignment UI

In the Parts panel, each part's expanded settings section contains:

- **Group** dropdown — "None", existing groups (labelled "Group 1", "Group 2", …), and "+ New group".
  Selecting "+ New group" creates a fresh bracket group for that part alone; the user can then
  join other parts to it from their own dropdowns.
- **Symbol** selector — "Bracket [" or "Brace {". Appears only when the part is in a group.
  Changing the symbol updates all parts in the group simultaneously.

**Auto-group on first Add Part**: when the score has all-ungrouped parts and a second part is
added, every part (including the new one) is automatically placed in a shared bracket group.
This ensures newly built scores get grouping by default without extra steps.

---

## Known limitations & future work
- **Nested groups**: MusicXML allows nested `<part-group>` elements (e.g., a bracket spanning
  all strings with sub-brackets for violin desks). Currently only the outermost group is
  applied per part.
- **Repeat barlines** (`repeat-start`, `repeat-end`): the right-side connector uses
  `BOLD_DOUBLE_RIGHT` which is close but not a perfect match for the full repeat symbol.
- **Grand staff**: when a single Part has two staves (piano), the brace should span both
  staves of that part. This requires multi-stave Part support, which is deferred.
