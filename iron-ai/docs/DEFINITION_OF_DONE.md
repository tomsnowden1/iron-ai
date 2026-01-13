# Definition of Done (Baseline)

Use this checklist for every PR unless explicitly scoped otherwise.

## Product & UX
- [ ] Requirements in the issue/spec are implemented and verified.
- [ ] User-facing copy is clear and free of typos.
- [ ] UX matches the design intent (spacing, alignment, states).

## Code & Quality
- [ ] Changes follow existing patterns and style conventions.
- [ ] No dead code, debug logs, or commented-out code left behind.
- [ ] Error handling is in place for new async workflows.

## Data & Safety
- [ ] Data migrations or schema changes are backward compatible.
- [ ] Sensitive data is not logged or exposed in UI/exports.

## Testing & Validation
- [ ] Relevant tests/builds run locally (or documented if skipped).
- [ ] Manual smoke check performed for affected flows.

## Documentation
- [ ] Docs updated for new workflows or settings.
- [ ] Release notes or changelog updated if required.
