const EDWIN_VARIANTS = [
  { weight: '400', style: 'normal', file: 'Edwin-Roman.otf' },
  { weight: '400', style: 'italic', file: 'Edwin-Italic.otf' },
  { weight: '700', style: 'normal', file: 'Edwin-Bold.otf' },
  { weight: '700', style: 'italic', file: 'Edwin-BoldItalic.otf' },
] as const

export async function loadNotationFonts(): Promise<void> {
  const loads = EDWIN_VARIANTS.map(({ weight, style, file }) => {
    const url = new URL(`../assets/fonts/${file}`, import.meta.url).href
    const face = new FontFace('Edwin', `url(${url})`, { weight, style })
    return face.load().then(loaded => { document.fonts.add(loaded) })
  })
  await Promise.all(loads)
}
