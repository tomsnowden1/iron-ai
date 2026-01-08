# AI Coach Platform

## Overview
The AI Coach Platform adds a tool-enabled chat experience that can read workout data,
optionally remember preferences, and propose safe write actions that require explicit
user confirmation.

## Core Modules
- `src/features/coach/CoachView.jsx`: Chat UI, context panel, proposals, and tool visibility.
- `src/coach/orchestrator.js`: Request orchestration, tool calling, and streaming flow.
- `src/coach/tools.js`: Tool registry, schemas, and handlers.
- `src/coach/context.js`: Deterministic context snapshot builder with size caps.
- `src/coach/memory.js`: Coach Memory schema helpers and summaries.
- `src/services/openai.js`: Streaming chat completions with tool calls.

## Data Flow
1. User sends a message.
2. Orchestrator builds a system prompt and optional context snapshot.
3. OpenAI returns either an assistant response or tool calls.
4. Read tools execute immediately; write tools become proposals.
5. The assistant responds (streamed) with tool results or a proposal prompt.
6. User confirms or cancels write proposals; confirmed writes execute atomically.

## Guardrails
- Context sharing is off by default and scoped by user selection.
- Write tools never execute without explicit confirmation.
- Context snapshots are size-bounded and marked when truncated.
- Coach Memory is only included when enabled in Settings.
- Read tools are enabled only for the scopes the user selects.
- Equipment-aware coaching relies on workout space context and never recommends unavailable gear.

## Extensibility
Add new tools or context sources by extending:
- `toolDefinitions` in `src/coach/tools.js`
- snapshot sections in `src/coach/context.js`
- UI affordances in `src/features/coach/CoachView.jsx`
