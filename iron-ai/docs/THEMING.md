# Theming

## Tokens
Theme tokens live in `src/styles/theme.css` under `:root[data-theme="light"]` and `:root[data-theme="dark"]`.

Required semantic tokens include:
- `--color-bg`
- `--color-surface`
- `--color-surface-muted`
- `--color-text`
- `--color-text-muted`
- `--color-border`
- `--color-primary`
- `--color-primary-hover`
- `--color-destructive`
- `--color-shadow`

Shared spacing, radius, and shadow presets are defined in `:root`.

## Adding theme-aware styles
1) Use semantic tokens (e.g. `var(--color-surface)`), never raw colors.
2) Prefer existing tokens; add new tokens in both light/dark blocks when needed.
3) Keep shadows in `--shadow-*` presets for consistency.

## Theme selection logic
`useTheme` in `src/utils/useTheme.js` manages:
- Modes: `light`, `dark`, `system`
- Persistence in `localStorage` under `ironai.theme`
- Applying `data-theme` on `document.documentElement`
- Syncing with OS changes when in `system` mode

On first load, `index.html` sets `data-theme` before the app renders to avoid theme flash.
