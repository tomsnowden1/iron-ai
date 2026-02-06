import { z } from "zod";

const JSON_FENCE_REGEX = /```json\s*([\s\S]*?)```/gi;
const STRICT_JSON_FENCE_REGEX = /^\s*```json\s*([\s\S]*?)\s*```\s*$/i;

const WorkoutExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.union([z.number().int().positive(), z.string().min(1)]),
  reps: z.union([z.number().int().positive(), z.string().min(1)]),
});

export const WorkoutPlanSchema = z.object({
  name: z.string().min(1).optional(),
  exercises: z.array(WorkoutExerciseSchema).min(1),
});

const TemplateExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  sets: z.number().int().positive(),
  reps: z.number().int().positive(),
  warmupSets: z.number().int().nonnegative().optional(),
});

export const TemplateJsonSchema = z.object({
  name: z.string().min(1),
  exercises: z.array(TemplateExerciseSchema).min(1),
});

const CONTEXT_REQUEST_REGEX =
  /enable context|turn on context|share context|choose (a )?gym|select (a )?gym|pick (a )?gym/i;
const CONTEXT_CLAIM_REGEX =
  /available equipment|using .*equipment|based on .*equipment|i can see .*equipment|with your equipment/i;
const WORKOUT_REQUEST_REGEX = /\b(workout|routine|session|plan)\b/i;

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeZodErrors(error) {
  if (!error?.issues?.length) return "Validation failed.";
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function extractJsonFences(text) {
  const value = String(text ?? "");
  const fences = [];
  let match = null;
  while ((match = JSON_FENCE_REGEX.exec(value)) !== null) {
    fences.push(match[1] ?? "");
  }
  return fences;
}

function validateContextOffWorkout(text) {
  const claimsEquipment = CONTEXT_CLAIM_REGEX.test(text);
  if (claimsEquipment) {
    return {
      valid: false,
      error:
        "Context is off, so the response cannot claim it can see available equipment.",
    };
  }
  const asksForContext = CONTEXT_REQUEST_REGEX.test(text);
  if (!asksForContext) {
    return {
      valid: false,
      error: "Context is off, so the response must ask to enable context or choose a gym.",
    };
  }
  return { valid: true, error: null };
}

function validateWorkoutPlanOutput(text) {
  const fences = extractJsonFences(text);
  if (!fences.length) {
    return {
      valid: false,
      error:
        "Workout responses must include a fenced ```json block with a WorkoutPlan object.",
    };
  }
  let lastSchemaError = "Workout plan JSON is invalid.";
  for (const raw of fences) {
    const parsed = safeParseJson(raw);
    if (!parsed) {
      lastSchemaError = "Workout plan JSON could not be parsed.";
      continue;
    }
    const validation = WorkoutPlanSchema.safeParse(parsed);
    if (validation.success) {
      return { valid: true, parsed: validation.data, error: null };
    }
    lastSchemaError = normalizeZodErrors(validation.error);
  }
  return { valid: false, parsed: null, error: lastSchemaError };
}

export function validateTemplateJsonOutput(text) {
  const match = String(text ?? "").match(STRICT_JSON_FENCE_REGEX);
  if (!match) {
    return {
      valid: false,
      parsed: null,
      error:
        "Template conversion must return only one fenced ```json block with no extra text.",
    };
  }
  const parsed = safeParseJson(match[1] ?? "");
  if (!parsed) {
    return {
      valid: false,
      parsed: null,
      error: "Template JSON could not be parsed.",
    };
  }
  const validation = TemplateJsonSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      valid: false,
      parsed: null,
      error: normalizeZodErrors(validation.error),
    };
  }
  return { valid: true, parsed: validation.data, error: null };
}

export function classifyCoachResponseMode({ userMessage, responseMode }) {
  if (responseMode === "template_json") return "template_json";
  if (WORKOUT_REQUEST_REGEX.test(String(userMessage ?? ""))) return "workout";
  return "general";
}

export function validateCoachResponse({
  userMessage,
  assistantText,
  responseMode,
  contextEnabled,
}) {
  const mode = classifyCoachResponseMode({ userMessage, responseMode });
  const text = String(assistantText ?? "").trim();

  if (mode === "template_json") {
    const result = validateTemplateJsonOutput(text);
    return { ...result, mode };
  }

  if (mode === "workout") {
    if (!contextEnabled) {
      const result = validateContextOffWorkout(text);
      return { ...result, parsed: null, mode };
    }
    const result = validateWorkoutPlanOutput(text);
    return { ...result, mode };
  }

  return { valid: true, parsed: null, error: null, mode };
}

const WORKOUT_PLAN_SCHEMA_TEXT =
  "{ name?: string, exercises: [{ name: string, sets: number|string, reps: number|string }] }";
const TEMPLATE_JSON_SCHEMA_TEXT =
  "{ name: string, exercises: [{ exerciseId: number, sets: number, reps: number, warmupSets?: number }] }";

export function buildRepairPrompt({
  validationMode,
  contextEnabled,
  invalidContent,
  selectedGym,
}) {
  const gymLabel = selectedGym?.name ? `Selected gym: ${selectedGym.name}` : "Selected gym: none";
  const invalid = String(invalidContent ?? "");

  if (validationMode === "template_json") {
    return [
      "REPAIR TASK: The previous output failed template JSON validation.",
      "Return ONLY a fenced ```json block, with no extra text before or after.",
      `Schema: ${TEMPLATE_JSON_SCHEMA_TEXT}`,
      "Invalid content:",
      invalid,
      "Rule: return ONLY the corrected output.",
    ].join("\n");
  }

  if (validationMode === "workout" && !contextEnabled) {
    return [
      "REPAIR TASK: Context sharing is OFF.",
      "Do NOT claim you can see equipment.",
      "Ask the user to enable context or choose/select a gym, then stop.",
      "Do not include a workout list in this response.",
      "Invalid content:",
      invalid,
      "Rule: return ONLY the corrected output.",
    ].join("\n");
  }

  return [
    "REPAIR TASK: The previous workout output failed validation.",
    "Return a fenced ```json block containing a WorkoutPlan with at least 5 exercises.",
    `Schema: ${WORKOUT_PLAN_SCHEMA_TEXT}`,
    gymLabel,
    "Each exercise must include name, sets, and reps.",
    "Invalid content:",
    invalid,
    "Rule: return ONLY the corrected output.",
  ].join("\n");
}

export function getValidationFailureMessage(mode) {
  if (mode === "template_json") {
    return "Coach had trouble formatting template JSON. Please tap Retry.";
  }
  if (mode === "workout") {
    return "Coach had trouble formatting a complete workout. Please tap Retry.";
  }
  return "Coach response validation failed. Please tap Retry.";
}
