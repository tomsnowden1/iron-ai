---
name: ironai-ui-polish
description: Improve IronAI UI consistency through CSS/layout polish and visual alignment without changing business logic or data models. Use when requests involve spacing, typography, component alignment, responsive layout cleanup, loading/empty state presentation, or parity between pages such as Templates and Workouts.
---

# IronAI UI Polish

Polish and normalize UI presentation in the IronAI app while preserving existing behavior. Focus on visual consistency, incremental edits, and fast verification.

## Operating Mode

1. Output a short plan before writing code.
2. Include a file list and step list in that plan.
3. Implement changes in small, sequential steps.

## Guardrails

1. Change UI/CSS only; do not change business logic, API behavior, or data models.
2. Reuse existing components, tokens, utilities, and style patterns before adding new styles.
3. Keep edits small and scoped to the requested screens.
4. Avoid refactors unrelated to the visual request.

## Workflow

1. Identify target pages/components and choose a reference page to match (for example: Templates as reference for Workouts parity work).
2. Apply incremental presentation fixes:
   - spacing, grid, card rhythm, typography scale, and alignment
   - consistent loading/empty states (presentation only)
3. Verify manually:
   - run `npm run dev`
   - click through updated screens
   - confirm no new browser console errors
4. Optionally run `npm run build` when quick to catch import or bundling mistakes.
5. Ship:
   - commit with a clear message
   - open PR with `git prmain`

## Requirements Checklist And Traceability

Load `references/requirements-checklist.md` and apply it in every UI polish task.

At the end of work, provide a brief traceability section:

- Requested UI outcomes
- Files changed
- How each requirement was verified (manual smoke/build/test)
- What was intentionally not changed (logic/data)
