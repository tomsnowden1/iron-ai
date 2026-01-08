What changed
- Added a theme + UI primitive layer and refactored screens to use consistent cards, headers, buttons, and form controls.
- Updated Templates, Workout, History, Settings, and Summary views to the new layout while keeping all logic intact.
- Refreshed the bottom tab bar, modal styling, and empty states for a more modern, cohesive UI.

Theme tokens
- Global design tokens live in `src/styles/theme.css`.
- Component and layout styles live in `src/styles/ui.css`.

Using UI primitives
- Import from `src/components/ui` (e.g., `Button`, `Input`, `Select`, `Label`, `Card`, `PageHeader`).
- `Button` supports `variant` (primary/secondary/ghost/destructive), `size` (sm/md/lg), and `loading`.
- Wrap content with `Card`, and compose with `CardHeader`, `CardBody`, and `CardFooter` for sections.
