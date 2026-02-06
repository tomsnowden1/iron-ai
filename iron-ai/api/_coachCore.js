const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_COACH_MODEL = "gpt-4o-mini";
const SUPPORTED_ACTIONS = new Set(["streamChatCompletion", "createChatCompletion"]);

function jsonResponse(status, body) {
  return { status, body };
}

function errorResponse(status, message, code = null) {
  return jsonResponse(status, {
    error: {
      message,
      code,
    },
  });
}

function normalizeRequestPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload;
}

function extractCompletionContent(completion) {
  const message = completion?.choices?.[0]?.message;
  if (!message) return "";
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        return typeof part?.text === "string" ? part.text : "";
      })
      .join("")
      .trim();
  }
  return "";
}

function normalizeToolCalls(completion) {
  const message = completion?.choices?.[0]?.message;
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.map((call) => ({
    id: call.id,
    type: call.type ?? "function",
    function: {
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? "",
    },
  }));
}

async function parseOpenAiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return errorResponse(
    response.status,
    payload?.error?.message || "OpenAI request failed.",
    payload?.error?.code ?? null
  );
}

function isProductionBlocked(env) {
  return env?.VERCEL_ENV === "production" && env?.ALLOW_COACH_PROD !== "true";
}

function buildOpenAiBody(payload) {
  const action = payload.action ?? "createChatCompletion";
  const body = {
    model: payload.model || DEFAULT_COACH_MODEL,
    messages: payload.messages,
    temperature:
      typeof payload.temperature === "number" ? payload.temperature : 0.2,
  };

  if (action === "streamChatCompletion" && Array.isArray(payload.tools)) {
    body.tools = payload.tools;
  }

  if (action === "createChatCompletion" && payload.responseFormat) {
    body.response_format = payload.responseFormat;
  }

  return body;
}

export async function handleCoachRequest({ payload, env, fetchImpl = fetch }) {
  if (isProductionBlocked(env)) {
    return errorResponse(
      403,
      "Coach is disabled in production. Set ALLOW_COACH_PROD=true to enable it."
    );
  }

  const openAiKey = String(env?.OPENAI_API_KEY ?? "").trim();
  if (!openAiKey) {
    return errorResponse(500, "Server is missing OPENAI_API_KEY.");
  }

  const requestPayload = normalizeRequestPayload(payload);
  if (!requestPayload) {
    return errorResponse(400, "Invalid JSON body.");
  }

  const action = requestPayload.action ?? "createChatCompletion";
  if (!SUPPORTED_ACTIONS.has(action)) {
    return errorResponse(400, "Unsupported coach action.");
  }
  if (!Array.isArray(requestPayload.messages)) {
    return errorResponse(400, "messages must be an array.");
  }

  const response = await fetchImpl(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify(buildOpenAiBody(requestPayload)),
  });

  if (!response.ok) {
    return parseOpenAiError(response);
  }

  const completion = await response.json();
  if (action === "streamChatCompletion") {
    return jsonResponse(200, {
      content: extractCompletionContent(completion),
      toolCalls: normalizeToolCalls(completion),
    });
  }

  return jsonResponse(200, completion);
}

