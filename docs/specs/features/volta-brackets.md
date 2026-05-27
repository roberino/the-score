# Volta Brackets

## Overview

Volta brackets (first/second endings) allow a repeated section to be played differently on each pass — the first time through plays the 1st ending, the repeat plays the 2nd ending, and so on.

## User workflow

1. In **Select** mode, select one or more whole bars.
2. The selection context menu's **Volta** tab shows buttons **1 · 2 · 3**.
3. Clicking a number applies a volta bracket covering the selected measure range with that ending number.
4. Clicking the same number again removes the volta.

* Note: volta will only be available when valid whole bar selection is made

## Data model

Voltas are stored at the **Score** level (not per-staff) because repeats are global — all parts jump back to the same measure simultaneously.

```typescript
interface Volta {
  readonly id: string
  readonly number: 1 | 2 | 3
  readonly startMeasureIndex: number  // 0-based, inclusive
  readonly endMeasureIndex: number    // 0-based, inclusive
}
// score.voltas?: readonly Volta[]
```

## Commands

| Command | Payload |
|---------|---------|
| `ADD_VOLTA` | `{ volta: Volta }` |
| `REMOVE_VOLTA` | `{ voltaId: string }` |

## Rendering

Uses VexFlow's `stave.setVoltaType(type, label, 0)` called before `stave.draw()`, first part only:

| Position | VoltaType |
|----------|-----------|
| Single measure | `BEGIN_END` |
| First of multi | `BEGIN` |
| Middle | `MID` |
| Last | `END` |

## Playback

`buildPlaybackSequence` is extended to accept `Volta[]`. When iterating through a repeat section (bounded by `repeat-start` / `repeat-end` barlines), the sequence builder tracks the current pass count and skips measures whose volta number doesn't match the current pass:

- Pass 1: play only volta-1 measures; skip volta-2/3
- Pass 2: skip volta-1; play volta-2; skip volta-3
- Pass 3 (if present): skip volta-1 and 2; play volta-3

Measures with no volta are always played.

## MusicXML

### Export

Beginning of a volta measure:
```xml
<barline location="left">
  <ending number="1" type="start"/>
</barline>
```

End of a volta measure:
```xml
<barline location="right">
  <ending number="1" type="stop"/>
</barline>
```

### Import

`<ending>` elements inside `<barline>` elements are parsed to reconstruct the volta list, matching start/stop pairs by ending number.
