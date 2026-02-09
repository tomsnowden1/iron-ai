const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const COACH_API_URL = "/api/coach";
export const DEFAULT_COACH_MODEL = "gpt-4o-mini";

function createStatusError(message, status, code = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireApiKey(apiKey) {
  const resolved = String(apiKey ?? "").trim();
  if (!resolved) {
    throw createStatusError("OpenAI API key is required.", 401);
  }
  return resolved;
}

async function parseError(response) {
  let errorBody = null;
  try {
    errorBody = await response.json();
  } catch {
    errorBody = null;
  }
  throw createStatusError(
    errorBody?.error?.message || "OpenAI request failed.",
    response.status,
    errorBody?.error?.code ?? null
  );
}

async function parseCoachError(response) {
  let errorBody = null;
  try {
    errorBody = await response.json();
  } catch {
    errorBody = null;
  }
  throw createStatusError(
    errorBody?.error?.message || "Coach request failed.",
    response.status,
    errorBody?.error?.code ?? null
  );
}

async function requestCoachServer(payload, signal) {
  const response = await fetch(COACH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    await parseCoachError(response);
  }

  return response.json();
}

function mergeToolCallDelta(toolCalls, deltaCalls) {
  deltaCalls.forEach((deltaCall) => {
    const index = deltaCall.index ?? 0;
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: deltaCall.id,
        type: deltaCall.type,
        function: { name: "", arguments: "" },
      };
    }
    if (deltaCall.id) toolCalls[index].id = deltaCall.id;
    if (deltaCall.type) toolCalls[index].type = deltaCall.type;
    if (deltaCall.function?.name) {
      toolCalls[index].function.name = deltaCall.function.name;
    }
    if (deltaCall.function?.arguments) {
      toolCalls[index].function.arguments += deltaCall.function.arguments;
    }
  });
}

export async function streamChatCompletion({
  apiKey,
  useServerKey = false,
  model = DEFAULT_COACH_MODEL,
  messages,
  tools,
  onDelta,
  onStart,
  onEnd,
  signal,
}) {
  if (useServerKey) {
    const result = await requestCoachServer(
      {
        action: "streamChatCompletion",
        model,
        messages,
        tools,
      },
      signal
    );
    const content = String(result?.content ?? "").trim();
    const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];

    if (content && !toolCalls.length) {
      onStart?.();
      onDelta?.(content);
      onEnd?.();
    }

    return { content, toolCalls };
  }

  const resolvedApiKey = requireApiKey(apiKey);
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: true,
      temperature: 0.2,
    }),
    signal,
  });

  if (!response.ok) {
    await parseError(response);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const error = new Error("Streaming not supported.");
    error.status = 500;
    throw error;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls = [];
  let sawToolCalls = false;
  let started = false;

  let doneStreaming = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.replace(/^data:\s*/, "");
      if (data === "[DONE]") {
        doneStreaming = true;
        break;
      }
      if (!data) continue;

      let payload = null;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = payload?.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.tool_calls?.length) {
        sawToolCalls = true;
        mergeToolCallDelta(toolCalls, delta.tool_calls);
      }

      if (delta.content && !sawToolCalls) {
        if (!started) {
          onStart?.();
          started = true;
        }
        content += delta.content;
        onDelta?.(delta.content);
      }
    }
    if (doneStreaming) break;
  }

  if (started) {
    onEnd?.();
  }

  return { content: content.trim(), toolCalls };
}

export async function createChatCompletion({
  apiKey,
  useServerKey = false,
  model = DEFAULT_COACH_MODEL,
  messages,
  responseFormat,
  temperature = 0.2,
  signal,
} = {}) {
  if (useServerKey) {
    return requestCoachServer(
      {
        action: "createChatCompletion",
        model,
        messages,
        responseFormat,
        temperature,
      },
      signal
    );
  }

  const resolvedApiKey = requireApiKey(apiKey);
  const body = {
    model,
    messages,
    temperature,
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await parseError(response);
  }

  return response.json();
}

export async function testOpenAIKey({ apiKey, signal } = {}) {
  const resolvedApiKey = requireApiKey(apiKey);
  const response = await fetch(OPENAI_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${resolvedApiKey}`,
    },
    signal,
  });

  if (!response.ok) {
    await parseError(response);
  }

  return true;
}
