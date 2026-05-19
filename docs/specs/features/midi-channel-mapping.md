# Advanced MIDI Channel Mapping

## Goal

Allow each part to be assigned a specific MIDI output channel (1–16), so that external synthesisers and DAWs can route parts independently.

## Decisions

| Question | Answer |
|---|---|
| Direction | Output only — affects MIDI playback, not input |
| UI location | Parts panel, inside the expanded part row |
| Persistence | Saved in the score file (`part.midiChannel`) |
| Conflict handling | Allowed — no validation |

## Model

`Part.midiChannel?: number` — 1-based (1–16), optional for backward compatibility. Parts in scores created before this feature fall back to `partIndex + 1`, capped at 16.

## Behaviour

- When playing back in MIDI output mode, each part sends note-on/off and program-change messages on its assigned channel.
- Channel 10 is conventionally reserved for percussion; the UI labels it "10 (Perc)".
- When a new part is added, its default channel is `min(existingPartCount + 1, 16)`.
- The channel selector is always visible in the expanded parts panel row (not gated by audio mode), because it is a score-level property.

## Scope

- `Part` interface: add `midiChannel?: number`
- `SET_PART_METADATA` command: add `midiChannel?: number`
- `ADD_PART` command: add `midiChannel?: number`
- `midiOutputEngine.playScore`: use `part.midiChannel` instead of `partIndex`
- `PartsPanel` / `PartRow`: channel dropdown (1–16)
