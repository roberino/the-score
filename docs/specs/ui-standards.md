# Volta UI Standards

Standards for interactive UI elements in the Volta renderer. Follow these when building or modifying any panel, dropdown, or context menu.

---

## Colours and theme

All UI is dark-themed. Reference values:

| Token | Value | Usage |
|---|---|---|
| `surface` | `#1e1e1e` | Canvas / page background |
| `surface-raised` | `#252526` | Toolbar, panel backgrounds |
| `surface-card` | `#2d2d2d` | Button fill, input fill |
| `border` | `#444` / `#555` | Panel borders, button borders |
| `border-subtle` | `#333` / `#2a2a2a` | Dividers, grid lines |
| `text-primary` | `#d4d4d4` | Body text |
| `text-secondary` | `#aaa` / `#ccc` | Labels, secondary text |
| `text-muted` | `#888` / `#666` | Hints, disabled text |
| `text-disabled` | `#555` / `#444` | Fully disabled controls |
| `accent` | `#0e639c` | Active tab underline, selected state fill |
| `accent-light` | `#3b9ddd` | Active item text, checked indicators |
| `destructive` | `#e06c75` | Delete / destructive actions |

---

## Buttons

### Standard button (`btnBase`)

```
padding: 3px 8px
border-radius: 3px
border: 1px solid #555
background: #2d2d2d
color: #ccc
font-size: 11px
cursor: pointer
```

### Active / selected (`btnActive`)

Extends `btnBase`:

```
background: #0e639c
color: #fff
border: 1px solid #0e639c
```

### Disabled (`btnDisabled`)

Extends `btnBase`:

```
color: #555
cursor: not-allowed
```

---

## Close / dismiss button

**Rule: every panel and dropdown menu that requires an explicit dismiss action must use a `✕` icon button, not a text label.**

- Use the `✕` character (U+2715).
- Style: `background: none`, `border: none`, `color: #888`, `cursor: pointer`, `fontSize: 10–12px`.
- Position: top-right of the panel or menu header.
- Always call `onMouseDown={e => e.stopPropagation()}` to prevent drag/click-through.
- Do **not** use text labels ("Cancel", "Close", "Dismiss") as the dismiss action.

### Close button in a floating panel header

```tsx
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
  <span style={{ color: '#888', fontSize: 11 }}>Title</span>
  <button
    onClick={onClose}
    onMouseDown={e => e.stopPropagation()}
    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
  >✕</button>
</div>
```

### Close button in a dropdown / context menu

Place the close button in a header row at the **top** of the menu, before all items.

```tsx
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px 5px 14px', borderBottom: '1px solid #333' }}>
  <span style={{ fontSize: 11, color: '#888' }}>Menu title</span>
  <button
    onClick={onClose}
    onMouseDown={e => e.stopPropagation()}
    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
  >✕</button>
</div>
```

---

## Context menus (dropdowns)

Context menus are fixed-position dropdowns triggered by a click at the cursor position.

**Structure:**
1. Header row — title (muted, 11px) + ✕ close button
2. Divider (`borderTop: 1px solid #333`)
3. Action items (see item style below)
4. Optional destructive section — separated by divider, item in `#e06c75`

**Container style:**

```
position: fixed
background: #252526
border: 1px solid #444
border-radius: 6px
box-shadow: 0 4px 16px rgba(0,0,0,0.4)
min-width: 200px
font-size: 12px
color: #ccc
overflow: hidden
z-index: 3000
```

**Item style:**

```
padding: 6px 14px
cursor: pointer
user-select: none
white-space: nowrap
```

Active / selected item text: `#3b9ddd` with `✓ ` prefix.
Destructive item text: `#e06c75`.

**Behaviour:**
- Close on: item selection, `✕` button, Escape key.
- `onMouseDown={e => e.stopPropagation()}` on the container prevents the canvas from consuming the click.

---

## Floating panels

Floating panels are draggable, fixed-position containers used for multi-action editing (e.g. the note/bar selection context menu).

**Structure:**
1. Drag handle row — drag icon + summary text (left) + ✕ button (right). Cursor `grab` / `grabbing`.
2. Actions row — operation buttons using `btnBase` / `btnActive`.
3. Optional tab bar — underline tabs.
4. Tab content area.

**Container style:** same as context menus but with `background: #1e1e1e` and `padding: 8px 10px`.

---

## Pickers (modal-adjacent overlays)

Pickers (barline picker, key signature picker, time signature picker, etc.) use an `onClose` prop. They handle Escape and click-outside internally; they do not need a visible ✕ button unless they have a persistent header.

---

## Dividers

Use `<div style={{ borderTop: '1px solid #333', margin: '2px 0' }} />` to separate logical groups within a menu or panel.
