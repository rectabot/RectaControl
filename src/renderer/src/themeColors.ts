/** The two surfaces that have to agree with a theme from outside the stylesheet.
 *
 *  Everything else takes its colour from a Tailwind class and index.css settles it. These
 *  two cannot: the 3D view clears its canvas through WebGL, and the window paints itself
 *  before there is a stylesheet at all. Both had a colour of their own baked in, and both
 *  were right on the dark theme and wrong on the other three.
 *
 *  `base` is the app's outermost background (`bg-base`) — what the window shows while a
 *  document is being replaced. `panel2` is the recessed surface (`bg-panel2`), which is
 *  the pane the 3D view sits in: matching it is what makes the viewport look like part of
 *  the app rather than a rectangle laid over it. The 3D background used to be `base` on
 *  every theme but dark, where it happened to be `panel2` — so on the light themes the
 *  viewport read a shade off from its own frame.
 *
 *  These duplicate values that index.css owns. Keep them in step: if a theme's background
 *  changes there, change it here.
 */
export type Theme = 'dark' | 'light' | 'softlight' | 'violet'

export const SURFACE: Record<Theme, { base: string; panel2: string }> = {
  dark: { base: '#020617', panel2: '#0a1421' },
  light: { base: '#e2e8f0', panel2: '#f1f5f9' },
  softlight: { base: '#dde2ea', panel2: '#e5e9f0' },
  violet: { base: '#100c1c', panel2: '#130f24' }
}

/** The theme's outermost background, for anything that needs it as a plain string. */
export const baseColor = (theme: string): string => (SURFACE[theme as Theme] ?? SURFACE.dark).base

/** The recessed surface the 3D view lives on. */
export const panelColor = (theme: string): string => (SURFACE[theme as Theme] ?? SURFACE.dark).panel2
