import type { DirectiveCategory } from './score'

// ── Dynamic levels ────────────────────────────────────────────────────────────

export const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as const
export type DynamicLevel = typeof DYNAMICS[number]

// ── Directive picker tabs ─────────────────────────────────────────────────────

export interface DirectiveTabDef {
  id: DirectiveCategory
  label: string
}

/**
 * Returns the ordered tab list for DirectivePicker.
 * Dynamic is always present; Tempo only on the first part's stave.
 */
export function buildDirectiveTabs(showTempo: boolean): DirectiveTabDef[] {
  return [
    ...(showTempo ? [{ id: 'tempo' as DirectiveCategory, label: 'Tempo' }] : []),
    { id: 'dynamic' as DirectiveCategory, label: 'Dynamic' },
    { id: 'expression' as DirectiveCategory, label: 'Expression' },
  ]
}

/** The tab that should be active on first open. */
export function defaultDirectiveTab(showTempo: boolean): DirectiveCategory {
  return showTempo ? 'tempo' : 'dynamic'
}
