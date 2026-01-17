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

const ActionDraftPayloadSchemas = {
  create_workout: z.object({ date: z.string().min(1) }).passthrough(),
  create_template: z.object({ name: z.string().min(1) }).passthrough(),
  create_gym: z.object({ name: z.string().min(1) }).passthrough(),
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
