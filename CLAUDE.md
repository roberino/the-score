# Volta — Agent Instructions

## Repository layout

This is a monorepo. Packages live under `packages/`:

| Path | Contents |
|---|---|
| `packages/volta-app/` | Electron desktop app (React + TypeScript) |

The root `package.json` is the npm workspace root (`private: true`). Run `npm install` from the repo root. To develop the app run `npm run dev` from the repo root, or `npm run dev` from inside `packages/volta-app/`.

## Documentation conventions

Feature specification files must live in `docs/specs/features/`. Do not create feature docs in `docs/features/` or any other location. When writing a new feature spec, place it at `docs/specs/features/<feature-name>.md`.

Other docs:
- `docs/backlog.md` — backlog and roadmap items
- `docs/specs/` — all specs (feature subdirectory as above)
