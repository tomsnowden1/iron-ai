---
name: ironai-coach-reliability
description: Improve IronAI AI Coach and template/workout generator reliability with focused fixes for prompt/context correctness, deterministic outputs, malformed model responses, and missing data edge cases (equipment/history/templates). Use when coach responses are inconsistent, generator output is invalid/partial, context assembly fails on sparse DB state, or trust/debug cues are needed for coach-visible inputs. Keep scope to coach-related code and PR flow to main via prmain.
---

# IronAI Coach Reliability

Harden AI Coach behavior with small, targeted changes. Avoid unrelated refactors.

## Scope Gate

- Touch only coach-related modules and tests (for example `src/coach/*`, `src/features/coach/*`, `tests/coach*.test.js`, `tests/actionDraft*.test.js`).
- Prefer normalization, validation, and fallback logic over broad rewrites.
- Keep UI/debug changes lightweight and directly tied to reliability.

## Execution Mode

- Before coding, output a short plan with:
  - file list
  - numbered implementation steps
- Implement step-by-step and report progress briefly.

## Reliability Workflow

### 1) Establish Contract

- Define the required output structure for the touched flow.
- Confirm minimum viable context that must always exist, even with sparse DB data.
- Start with existing contracts/schemas:
  - `src/coach/actionDraftContract.js`
  - `src/coach/contract.js`
  - `src/coach/schema.js`
  - `src/coach/context.js`

### 2) Reproduce Minimally

- Create or identify one minimal failing scenario before fixing.
- Favor deterministic fixtures and narrow test coverage over broad integration changes.
- Include at least one edge-case input:
  - no equipment
  - no recent workouts/history
  - missing templates or missing optional fields

### 3) Fix with Small Guarded Changes

- Add explicit fallbacks for missing data in context builders and adapters.
- Tighten prompt/context assembly to remove ambiguity and preserve required fields.
- Add validation or repair for malformed model payloads:
  - parse safely
  - reject invalid contract payloads
  - recover with a bounded fallback response shape

### 4) Add Guardrails

- Add/adjust focused tests if a harness exists.
- Add a lightweight debug/trust cue only when it materially helps verification (for example contract version, context fingerprint, or truncation markers).
- Do not expose sensitive data in logs or UI.

### 5) Verify

- Run targeted tests first, then broader checks as needed.
- Always run:
  - `npm run test:run -- tests/coach.test.js tests/coachActionDraft.test.js tests/actionDraftExecution.test.js tests/actionDraftState.test.js`
  - `npm run build`
- Perform manual smoke for:
  - one typical coach flow
  - one edge-case coach flow with sparse context

### 6) Ship

- Commit with a focused reliability message.
- Open/update PR to `main` via:
  - `npm run prmain`
  - or `git prmain` if your environment provides that alias.

## Requirements Checklist and Traceability

- Apply the project checklist from `docs/DEFINITION_OF_DONE.md`.
- Use the traceability template in `references/checklist.md` in PR notes or final handoff.

