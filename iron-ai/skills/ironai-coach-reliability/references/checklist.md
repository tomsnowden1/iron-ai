# IronAI Coach Reliability Checklist + Traceability

Use this after coach-related changes. Base checklist source: `docs/DEFINITION_OF_DONE.md`.

## Requirements Checklist

- [ ] Requirements in issue/spec implemented and verified.
- [ ] User-facing copy clear and typo-free.
- [ ] UX states and behavior match intent.
- [ ] Changes follow existing style/patterns; no dead/debug code left.
- [ ] Async error handling present for new/updated coach workflows.
- [ ] No sensitive data exposed in logs/debug surfaces.
- [ ] Relevant tests/build run locally (or skipped with reason).
- [ ] Manual smoke check completed for affected coach flows.
- [ ] Docs/changelog updated if behavior changed.

## Traceability Snippet

Paste this into the PR body and fill it:

```md
### Reliability Traceability
| Requirement / Risk | Change (File) | Verification | Result |
|---|---|---|---|
| Contract validity for coach output | src/coach/actionDraftContract.js | npm run test:run -- tests/coachActionDraft.test.js | PASS |
| Sparse context fallback (no equipment/history) | src/coach/context.js | npm run test:run -- tests/coach.test.js | PASS |
| Deterministic repair/reject path for malformed payloads | src/coach/orchestrator.js | npm run test:run -- tests/actionDraftExecution.test.js | PASS |
| No regression in build | n/a | npm run build | PASS |
| Manual typical flow | Coach UI | Manual smoke | PASS |
| Manual edge-case flow | Coach UI (no equipment/history) | Manual smoke | PASS |
```

