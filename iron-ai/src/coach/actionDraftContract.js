import { z } from "zod";

export const ACTION_DRAFT_CONTRACT_VERSION = "coach_action_v1";

export const ActionDraftKinds = {
  create_workout: "create_workout",
  create_template: "create_template",
  create_gym: "create_gym",
};

export const ActionDraftRisks = {
  low: "low",
  medium: "medium",
  high: "high",
};

const NumericValue = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isFinite(Number(value)), {
    message: "Value must be numeric.",
  });

const NumericId = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isInteger(Number(value)) && Number(value) > 0, {
    message: "ID must be a positive integer.",
  });

const ActionDraftSetSchema = z
  .object({
    reps: NumericValue.optional(),
    weight: NumericValue.optional(),
    duration: NumericValue.optional(),
    rpe: NumericValue.optional(),
  })
  .passthrough();

const ActionDraftExerciseSchema = z
  .object({
    exerciseId: NumericId,
    sets: z.array(ActionDraftSetSchema).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const ActionDraftSuggestionSchema = z
  .object({
    exerciseId: NumericId,
    name: z.string().min(1),
  })
  .passthrough();

const ActionDraftNeedsReviewSchema = z
  .object({
    requestedName: z.string().min(1),
    suggestions: z.array(ActionDraftSuggestionSchema).max(5).optional(),
  })
  .passthrough();

const ActionDraftPayloadSchemas = {
  create_workout: z
    .object({
      name: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      gymId: NumericId.optional(),
      exercises: z.array(ActionDraftExerciseSchema).optional(),
      needsReview: z.array(ActionDraftNeedsReviewSchema).optional(),
      plannedDurationMins: NumericValue.optional(),
    })
    .refine(
      (value) =>
        Boolean(value.name || value.title) &&
        ((Array.isArray(value.exercises) && value.exercises.length > 0) ||
          (Array.isArray(value.needsReview) && value.needsReview.length > 0)),
      {
        message: "Workout draft requires a title and exercises or needsReview.",
      }
    )
    .passthrough(),
  create_template: z
    .object({
      name: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      gymId: NumericId.optional(),
      exercises: z.array(ActionDraftExerciseSchema).optional(),
      needsReview: z.array(ActionDraftNeedsReviewSchema).optional(),
      frequencyHint: z.string().optional(),
    })
    .refine(
      (value) =>
        Boolean(value.name || value.title) &&
        ((Array.isArray(value.exercises) && value.exercises.length > 0) ||
          (Array.isArray(value.needsReview) && value.needsReview.length > 0)),
      {
        message: "Template draft requires a title and exercises or needsReview.",
      }
    )
    .passthrough(),
  create_gym: z
    .object({
      name: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      equipmentIds: z.array(z.string()).optional(),
    })
    .refine((value) => value.name || value.title, {
      message: "Gym draft requires a name or title.",
    })
    .passthrough(),
};

const BaseActionDraftSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    risk: z.enum([ActionDraftRisks.low, ActionDraftRisks.medium, ActionDraftRisks.high]),
    title: z.string().min(1),
    summary: z.string().min(1),
  })
  .passthrough();

export const ActionDraftSchema = z.union([
  BaseActionDraftSchema.extend({
    kind: z.literal(ActionDraftKinds.create_workout),
    payload: ActionDraftPayloadSchemas.create_workout,
  }).passthrough(),
  BaseActionDraftSchema.extend({
    kind: z.literal(ActionDraftKinds.create_template),
    payload: ActionDraftPayloadSchemas.create_template,
  }).passthrough(),
  BaseActionDraftSchema.extend({
    kind: z.literal(ActionDraftKinds.create_gym),
    payload: ActionDraftPayloadSchemas.create_gym,
  }).passthrough(),
]);

export const ActionDraftContractSchema = z
  .object({
    contractVersion: z.literal(ACTION_DRAFT_CONTRACT_VERSION),
    assistantText: z.string().min(1),
    actionDraft: ActionDraftSchema.optional(),
  })
  .passthrough();

/** @typedef {import("zod").infer<typeof ActionDraftSchema>} ActionDraft */
/** @typedef {import("zod").infer<typeof ActionDraftContractSchema>} ActionDraftContract */

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ raw: match[1] ?? "" });
  }
  return blocks;
}

function stripCodeBlocks(text) {
  if (!text) return "";
  return text.replace(/```(?:json)?\s*[\s\S]*?```/gi, "").trim();
}

function formatZodErrors(error) {
  if (!error?.issues?.length) return "Validation failed.";
  return error.issues.map((issue) => issue.message).join("; ");
}

export function validateActionDraftContract(payload) {
  return ActionDraftContractSchema.safeParse(payload);
}

/**
 * @param {string} message
 * @returns {{
 *   assistantText: string,
 *   actionDraft?: ActionDraft,
 *   contractVersion?: string,
 *   parseErrors?: string[]
 * }}
 */
export function parseCoachActionDraftMessage(message) {
  const text = typeof message === "string" ? message : "";
  const parseErrors = [];
  const blocks = extractJsonBlocks(text);

  const attemptParse = (raw) => {
    const parsed = safeJsonParse(raw);
    if (!parsed) {
      parseErrors.push("Unable to parse action draft JSON.");
      return null;
    }
    const validation = validateActionDraftContract(parsed);
    if (!validation.success) {
      parseErrors.push(`Invalid action draft contract: ${formatZodErrors(validation.error)}`);
      return null;
    }
    return validation.data;
  };

  if (blocks.length) {
    for (const block of blocks) {
      const contract = attemptParse(block.raw);
      if (contract) {
        return {
          assistantText: contract.assistantText,
          actionDraft: contract.actionDraft,
          contractVersion: contract.contractVersion,
        };
      }
    }
  } else {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const contract = attemptParse(trimmed);
      if (contract) {
        return {
          assistantText: contract.assistantText,
          actionDraft: contract.actionDraft,
          contractVersion: contract.contractVersion,
        };
      }
    }
  }

  const fallbackText = stripCodeBlocks(text) || text.trim();
  return {
    assistantText: fallbackText,
    parseErrors: parseErrors.length ? parseErrors : undefined,
  };
}
