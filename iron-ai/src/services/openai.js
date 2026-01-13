const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
export const DEFAULT_COACH_MODEL = "gpt-4o-mini";

async function parseError(response) {
  let errorBody = null;
  try {
    errorBody = await response.json();
  } catch {
    errorBody = null;
  }
  const error = new Error(errorBody?.error?.message || "OpenAI request failed.");
  error.status = response.status;
  error.code = errorBody?.error?.code ?? null;
  throw error;
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
  model = DEFAULT_COACH_MODEL,
  messages,
  tools,
  onDelta,
  onStart,
  onEnd,
  signal,
}) {
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
  model = DEFAULT_COACH_MODEL,
  messages,
  responseFormat,
  temperature = 0.2,
  signal,
} = {}) {
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
      Authorization: `Bearer ${apiKey}`,
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
  const response = await fetch(OPENAI_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
  });

  if (!response.ok) {
    await parseError(response);
  }

  return true;
}
