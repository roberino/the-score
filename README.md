# Volta

Professional desktop music notation editor built with Electron, React, TypeScript, and VexFlow.

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 30 |
| UI | React 18 + TypeScript |
| State | Zustand + Immer |
| Notation | VexFlow 4 |
| Audio | Tone.js + Web Audio API |
| Build | electron-vite + Vite |
| Packaging | Electron Forge |
| Tests | Vitest |

## Prerequisites

- Node.js 20 LTS or later — https://nodejs.org
- npm 10+

On macOS, install Xcode command line tools if prompted:
```
xcode-select --install
```

## Getting started

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Run tests
npm test

# Type-check
npm run typecheck
```

## Project structure

```
src/
  main/               Electron main process (Node.js, privileged)
    index.ts            App entry, window creation, IPC handlers
    menu.ts             Native application menu

  preload/            Electron preload (contextBridge API surface)
    index.ts            Exposes electronAPI to renderer securely

  renderer/           React app (runs in Chromium, sandboxed)
    components/
      App.tsx           Root component, menu wiring, keyboard shortcuts
      ScoreCanvas.tsx   VexFlow canvas — renders the score
      Toolbar.tsx       Input mode, undo/redo, playback controls
      StatusBar.tsx     File info, BPM, zoom level
    engine/
      notationRenderer.ts  Score model → VexFlow → Canvas pipeline
    store/
      appStore.ts       Zustand store — all UI + score state
    styles/
      global.css

  shared/             Pure TypeScript, no framework dependencies
    score.ts            Core data model: Score, Part, Measure, Note…
    commands.ts         Command pattern — all score mutations go here

  tests/
    score.test.ts       Unit tests for model + commands
```

## Key architecture decisions

### Why the score model has no framework dependency
`src/shared/score.ts` and `src/shared/commands.ts` import nothing from
Electron, React, or VexFlow. This means:
- The model is fully unit-testable without Electron running
- You can serialise/deserialise (JSON) with no special handling
- The rendering engine and the audio engine both read the same model

### Why every edit is a Command
All mutations flow through `applyCommand()` in `commands.ts`. This is the
same Command pattern you'd use with MediatR in C#. Benefits:
- Undo/redo comes for free (store score snapshots or build inverse commands)
- Easy to add validation, logging, conflict resolution later
- The edit history is serialisable — useful for collaborative editing

### Why contextBridge / preload
Electron's security model requires `contextIsolation: true`. The renderer
(React app) cannot call Node.js APIs directly. Instead, the preload script
whitelists exactly the API surface the renderer needs and exposes it as
`window.electronAPI`. Think of it as a C# interface that the main process
implements and the renderer depends on.

## Building for distribution

```bash
# Package (no installer, just the .app/.exe)
npm run package

# Make installers for current platform
npm run make
```

For macOS distribution you'll need:
- An Apple Developer account
- Code signing certificate in Keychain
- `.env` file with `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

## Roadmap

- [ ] Phase 1 — Foundation (this scaffold)
- [ ] Phase 2 — Note input via keyboard + mouse click
- [ ] Phase 3 — Tone.js playback + MIDI device input
- [ ] Phase 4 — PDF export, MusicXML import/export
- [ ] Phase 5 — Distribution (code signing, installers, auto-update)
