import { DEFAULT_COACH_MODEL, createChatCompletion } from "./openai";

const MAX_ALIAS_COUNT = 10;
const MAX_LIST_COUNT = 12;

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "");
}

function normalizeText(value, maxLength = 160) {
  const cleaned = stripHtml(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function normalizeArray(value, { maxItems = MAX_LIST_COUNT } = {}) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list
    .map((item) => normalizeText(item, 140))
    .filter(Boolean)
    .slice(0, maxItems);
  return Array.from(new Set(cleaned));
}

function parseExerciseAutofillPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("AI response was not a valid object.");
  }

  const aliases = normalizeArray(payload.aliases, { maxItems: MAX_ALIAS_COUNT });
  const primaryMuscles = normalizeArray(payload.primaryMuscles);
  const secondaryMuscles = normalizeArray(payload.secondaryMuscles);
  const equipment = normalizeArray(payload.equipment);
  const instructions = normalizeArray(payload.instructions);
  const gotchas = normalizeArray(payload.gotchas);
  const category = normalizeText(payload.category, 80);
  const pattern = normalizeText(payload.pattern, 80);
  const youtubeSearchQuery = normalizeText(payload.youtubeSearchQuery, 120);

  return {
    aliases,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    category,
    pattern,
    instructions,
    gotchas,
    youtubeSearchQuery,
  };
}

export async function generateExerciseDetails({ apiKey, name, hints, signal } = {}) {
  const safeName = normalizeText(name, 80);
  if (!safeName) {
    throw new Error("Exercise name is required.");
  }

  const prompt = [
    "Return a JSON object with keys:",
    "aliases (array of strings),",
    "primaryMuscles (array), secondaryMuscles (array),",
    "equipment (array of equipment ids or common names),",
    "category (string), pattern (string),",
    "instructions (array of short steps),",
    "gotchas (array of short cautions),",
    "youtubeSearchQuery (string).",
    "Only return JSON, no markdown.",
    hints ? `Additional context: ${normalizeText(hints, 200)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await createChatCompletion({
    apiKey,
    model: DEFAULT_COACH_MODEL,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a fitness content assistant. Provide concise, safe, user-friendly exercise metadata.",
      },
      { role: "user", content: `Exercise name: ${safeName}. ${prompt}` },
    ],
    signal,
  });

  const rawContent = response?.choices?.[0]?.message?.content ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error("AI response could not be parsed. Please try again.");
  }

  return parseExerciseAutofillPayload(parsed);
}
