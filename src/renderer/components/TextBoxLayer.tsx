import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Placeholder from '@tiptap/extension-placeholder'
import { v4 as uuid } from 'uuid'
import { useAppStore } from '../store/appStore'
import type { TextBox } from '@shared/score'

// ── Global ProseMirror styles (injected once) ─────────────────────────────────

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const el = document.createElement('style')
  el.textContent = `
    .notation-textbox .ProseMirror { outline: none; font-family: inherit; }
    .notation-textbox .ProseMirror p { margin: 0; line-height: 1.55; font-size: 14px; }
    .notation-textbox .ProseMirror h1 { margin: 0 0 4px; font-size: 1.35em; font-weight: 700; line-height: 1.3; }
    .notation-textbox .ProseMirror h2 { margin: 0 0 2px; font-size: 1.1em;  font-weight: 600; line-height: 1.35; }
    .notation-textbox .ProseMirror ul,
    .notation-textbox .ProseMirror ol  { margin: 0; padding-left: 20px; }
    .notation-textbox .ProseMirror li  { line-height: 1.55; }
    .notation-textbox .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left; height: 0; pointer-events: none; color: #bbb; font-style: italic;
    }
  `
  document.head.appendChild(el)
}

// ── Colours offered in the bubble menu ───────────────────────────────────────

const PALETTE = ['#111111', '#cc2222', '#1a66cc', '#1a8833', '#8844cc', '#888888']

// ── Single text box ───────────────────────────────────────────────────────────

interface ItemProps {
  box: TextBox
  zoom: number
  isSelected: boolean
  isEditing: boolean
  onSelect:    () => void
  onStartEdit: () => void
  onCommit:    (html: string, width: number) => void
  onMove:      (x: number, y: number) => void
  onDelete:    () => void
}

function TextBoxItem({
  box, zoom, isSelected, isEditing,
  onSelect, onStartEdit, onCommit, onMove, onDelete,
}: ItemProps): JSX.Element {
  injectStyles()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: 'Type a note… (supports **bold**, *italic*, # heading)' }),
    ],
    content: box.html || '',
    editable: false,
    onBlur: ({ editor }) => {
      const w = (wrapperRef.current?.offsetWidth ?? box.width * zoom) / zoom
      onCommit(editor.getHTML(), w)
    },
  })

  // Sync editable + focus when edit mode changes
  useEffect(() => {
    if (!editor) return
    editor.setEditable(isEditing)
    if (isEditing) setTimeout(() => editor.commands.focus('end'), 0)
  }, [isEditing, editor])

  // Sync HTML when changed externally (undo/redo)
  useEffect(() => {
    if (!editor || isEditing) return
    if (editor.getHTML() !== box.html) {
      editor.commands.setContent(box.html || '', { emitUpdate: false })
    }
  }, [box.html, isEditing, editor])

  // Escape while editing → blur → triggers onBlur → commits
  const handleWrapperKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isEditing) {
      e.preventDefault()
      e.stopPropagation()
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
  }, [isEditing])

  // Drag-to-move via the handle bar
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const ox = box.x,     oy = box.y

    const mv = (ev: MouseEvent) =>
      onMove(Math.max(0, ox + (ev.clientX - sx) / zoom), Math.max(0, oy + (ev.clientY - sy) / zoom))

    const up = (ev: MouseEvent) => {
      mv(ev)
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
  }, [box.x, box.y, zoom, onMove])

  const border = isEditing
    ? '1.5px solid #4da3ff'
    : isSelected
    ? '1.5px solid #a0c8ff'
    : '1.5px solid rgba(0,0,0,0.10)'

  const shadow = isEditing
    ? '0 6px 24px rgba(0,0,0,0.14)'
    : isSelected
    ? '0 2px 10px rgba(0,0,0,0.09)'
    : '0 1px 4px rgba(0,0,0,0.06)'

  return (
    <div
      ref={wrapperRef}
      data-textbox=""
      className="notation-textbox"
      onKeyDown={handleWrapperKeyDown}
      onClick={e => { e.stopPropagation(); if (!isEditing) onSelect() }}
      onDoubleClick={e => { e.stopPropagation(); onStartEdit() }}
      style={{
        position:   'absolute',
        left:       box.x * zoom,
        top:        box.y * zoom,
        width:      box.width * zoom,
        minWidth:   100,
        background: '#fff',
        border,
        borderRadius: 8,
        boxShadow:  shadow,
        zIndex:     isEditing ? 50 : isSelected ? 40 : 30,
        overflow:   'hidden',
        resize:     isEditing ? 'horizontal' : 'none',
        transition: 'border-color 0.12s, box-shadow 0.12s',
      }}
    >
      {/* ── Drag handle bar ── */}
      <div
        onMouseDown={isEditing ? undefined : handleDragStart}
        style={{
          height:        20,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
          padding:       '0 8px',
          cursor:        isEditing ? 'default' : 'grab',
          background:    isSelected || isEditing ? '#f7f7f8' : 'transparent',
          borderBottom:  isSelected || isEditing ? '1px solid rgba(0,0,0,0.06)' : 'none',
          userSelect:    'none',
        }}
      >
        <span style={{ color: '#c8c8c8', fontSize: 11, letterSpacing: 2 }}>• • •</span>
        {isSelected && !isEditing && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete text box"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#c0c0c0', padding: 0, lineHeight: 1, display: 'flex',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Bubble menu ── */}
      {editor && (
        <BubbleMenu editor={editor}>
          <div style={{
            display:       'flex',
            alignItems:    'center',
            gap:           2,
            background:    '#1a1a1a',
            border:        '1px solid #333',
            borderRadius:  7,
            padding:       '4px 6px',
            boxShadow:     '0 4px 18px rgba(0,0,0,0.35)',
          }}>
            <BubbleBtn active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">
              <b>B</b>
            </BubbleBtn>
            <BubbleBtn active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">
              <i>I</i>
            </BubbleBtn>
            <BubbleBtn active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">
              <span style={{ textDecoration: 'underline' }}>U</span>
            </BubbleBtn>

            <Sep />

            <BubbleBtn active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
              H1
            </BubbleBtn>
            <BubbleBtn active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
              H2
            </BubbleBtn>

            <Sep />

            {PALETTE.map(c => (
              <button
                key={c}
                onMouseDown={e => e.preventDefault()}
                onClick={() => editor.chain().focus().setColor(c).run()}
                title="Text colour"
                style={{
                  width: 13, height: 13, borderRadius: '50%', padding: 0,
                  background: c, cursor: 'pointer',
                  border: editor.isActive('textStyle', { color: c })
                    ? '2px solid #fff'
                    : '1.5px solid rgba(255,255,255,0.15)',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </BubbleMenu>
      )}

      {/* ── Editor content ── */}
      <EditorContent
        editor={editor}
        style={{ padding: '7px 11px 9px', cursor: isEditing ? 'text' : 'default' }}
      />
    </div>
  )
}

// ── Micro components ──────────────────────────────────────────────────────────

function BubbleBtn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={title}
      style={{
        background:  active ? 'rgba(255,255,255,0.18)' : 'none',
        border:      'none',
        borderRadius: 4,
        color:       active ? '#fff' : '#bbb',
        cursor:      'pointer',
        fontSize:    11,
        fontFamily:  'inherit',
        padding:     '2px 6px',
        minWidth:    24,
        textAlign:   'center',
        lineHeight:  1.4,
      }}
    >{children}</button>
  )
}

function Sep(): JSX.Element {
  return <div style={{ width: 1, height: 14, background: '#333', margin: '0 3px', flexShrink: 0 }} />
}

// ── Layer ─────────────────────────────────────────────────────────────────────

export function TextBoxLayer({ zoom }: { zoom: number }): JSX.Element {
  const { score, dispatch } = useAppStore()
  const textBoxes = (score.textBoxes ?? []) as TextBox[]

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId,  setEditingId]  = useState<string | null>(null)

  // Click outside any box → deselect
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-textbox]')) {
        setSelectedId(null)
        setEditingId(null)
      }
    }
    window.addEventListener('mousedown', handle)
    return () => window.removeEventListener('mousedown', handle)
  }, [])

  // Delete key when box is selected but NOT in edit mode
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!selectedId || editingId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation()
        dispatch({ type: 'DELETE_TEXT_BOX', id: selectedId })
        setSelectedId(null)
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [selectedId, editingId, dispatch])

  return (
    <>
      {textBoxes.map(box => (
        <TextBoxItem
          key={box.id}
          box={box}
          zoom={zoom}
          isSelected={selectedId === box.id}
          isEditing={editingId === box.id}
          onSelect={() => { setSelectedId(box.id); setEditingId(null) }}
          onStartEdit={() => { setSelectedId(box.id); setEditingId(box.id) }}
          onCommit={(html, width) => {
            dispatch({ type: 'UPDATE_TEXT_BOX', id: box.id, html, width })
            setEditingId(null)
          }}
          onMove={(x, y) => dispatch({ type: 'UPDATE_TEXT_BOX', id: box.id, x, y })}
          onDelete={() => {
            dispatch({ type: 'DELETE_TEXT_BOX', id: box.id })
            setSelectedId(null)
          }}
        />
      ))}
    </>
  )
}

// ── Public helper ─────────────────────────────────────────────────────────────

export function makeTextBox(x: number, y: number): TextBox {
  return { id: uuid(), x, y, width: 220, html: '' }
}
