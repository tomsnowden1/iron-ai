import { ActionDraftKinds } from "../../coach/actionDraftContract";
import { validateToolInput } from "../../coach/tools";

function parseJsonCandidate(text) {
  try {
    return { parsed: JSON.parse(text), error: null };
  } catch (err) {
    return {
      parsed: null,
      error: `Unable to parse JSON${err?.message ? `: ${err.message}` : ""}.`,
    };
  }
}

function extractFencedCodeBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const regex = /```[ \t]*([^\s]*)?\s*([\s\S]*?)```/g;
  let match = null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: String(match[1] ?? "").trim().toLowerCase(),
      content: match[2] ?? "",
    });
  }
  return blocks;
}

function parseIntegerValue(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    return parsed;
  }
  return null;
}

function validateTemplateDraft(raw, fallbackName, templateTool) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { draft: null, error: "Template draft must be an object." };
  }
  const rawName =
    typeof raw.name === "string"
      ? raw.name
      : typeof raw.title === "string"
        ? raw.title
        : typeof fallbackName === "string"
          ? fallbackName
          : "";
  const name = rawName.trim();
  if (!name) {
    return { draft: null, error: "Template name is required." };
  }
  if (!Array.isArray(raw.exercises) || raw.exercises.length === 0) {
    return {
      draft: null,
      error: "Template exercises must be a non-empty array.",
    };
  }
  const exercises = [];
  for (let i = 0; i < raw.exercises.length; i += 1) {
    const entry = raw.exercises[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        draft: null,
        error: `exercises[${i}] must be an object.`,
      };
    }
    const exerciseId = parseIntegerValue(entry.exerciseId);
    if (exerciseId == null) {
      return {
        draft: null,
        error: `exercises[${i}].exerciseId must be a number.`,
      };
    }
    const sets = parseIntegerValue(entry.sets);
    if (sets == null) {
      return {
        draft: null,
        error: `exercises[${i}].sets must be a number.`,
      };
    }
    const reps = parseIntegerValue(entry.reps);
    if (reps == null) {
      return {
        draft: null,
        error: `exercises[${i}].reps must be a number.`,
      };
    }
    let warmupSets = null;
    if (entry.warmupSets != null) {
      warmupSets = parseIntegerValue(entry.warmupSets);
      if (warmupSets == null) {
        return {
          draft: null,
          error: `exercises[${i}].warmupSets must be a number.`,
        };
      }
    }
    exercises.push({
      exerciseId,
      sets,
      reps,
      ...(warmupSets != null ? { warmupSets } : {}),
    });
  }
  let spaceId = null;
  if (raw.spaceId != null) {
    spaceId = parseIntegerValue(raw.spaceId);
    if (spaceId == null) {
      return { draft: null, error: "spaceId must be a number." };
    }
  }
  const draft = {
    name,
    exercises,
    ...(spaceId != null ? { spaceId } : {}),
  };
  if (templateTool) {
    const validation = validateToolInput(templateTool, draft);
    if (!validation.valid) {
      return { draft: null, error: validation.errors.join("; ") };
    }
  }
  return { draft, error: null };
}

function resolveTemplateDraftFromActionDraft(actionDraft, templateTool) {
  if (!actionDraft) return { draft: null, error: null, found: false };
  if (
    actionDraft.kind !== ActionDraftKinds.create_template &&
    actionDraft.kind !== ActionDraftKinds.create_workout
  ) {
    return { draft: null, error: null, found: false };
  }
  const payload = actionDraft.payload ?? {};
  const fallbackName = payload.name ?? payload.title ?? actionDraft.title ?? null;
  const raw = { ...payload };
  if (!raw.name && fallbackName) raw.name = fallbackName;
  const result = validateTemplateDraft(raw, fallbackName, templateTool);
  return { ...result, found: true };
}

function resolveTemplateDraftFromText(text, templateTool) {
  const blocks = extractFencedCodeBlocks(text);
  if (!blocks.length) {
    return { draft: null, error: null, found: false, source: null };
  }

  const evaluateBlocks = (targetBlocks, source) => {
    let lastError = null;
    let foundCandidate = false;
    for (const block of targetBlocks) {
      foundCandidate = true;
      const { parsed, error } = parseJsonCandidate(block.content);
      if (!parsed) {
        lastError = error;
        continue;
      }
      if (parsed?.actionDraft) {
        const fromAction = resolveTemplateDraftFromActionDraft(
          parsed.actionDraft,
          templateTool
        );
        if (fromAction.draft) {
          return { draft: fromAction.draft, found: true, error: null, source };
        }
        if (fromAction.error) lastError = fromAction.error;
      }
      const normalized = validateTemplateDraft(parsed, null, templateTool);
      if (normalized.draft) {
        return { draft: normalized.draft, found: true, error: null, source };
      }
      if (normalized.error) lastError = normalized.error;
    }
    return { draft: null, found: foundCandidate, error: lastError, source };
  };

  const jsonBlocks = blocks.filter((block) => block.language === "json");
  const jsonResult = evaluateBlocks(jsonBlocks, "codeFence:json");
  if (jsonResult.draft) return jsonResult;

  const anyResult = evaluateBlocks(blocks, "codeFence:any");
  if (anyResult.draft) return anyResult;

  return {
    draft: null,
    found: jsonResult.found || anyResult.found,
    error: jsonResult.error ?? anyResult.error,
    source: jsonResult.source ?? anyResult.source,
  };
}

export function resolveTemplateDraftInfo({ actionDraft, text, templateTool }) {
  const actionResult = resolveTemplateDraftFromActionDraft(actionDraft, templateTool);
  if (actionResult.draft) {
    return {
      draft: actionResult.draft,
      found: true,
      valid: true,
      error: null,
      source: "actionDraft",
    };
  }

  const textResult = resolveTemplateDraftFromText(text, templateTool);
  if (textResult.draft) {
    return {
      draft: textResult.draft,
      found: true,
      valid: true,
      error: null,
      source: textResult.source,
    };
  }

  return {
    draft: null,
    found: actionResult.found || textResult.found,
    valid: false,
    error: actionResult.error ?? textResult.error,
    source: actionResult.found ? "actionDraft" : textResult.source,
  };
}
