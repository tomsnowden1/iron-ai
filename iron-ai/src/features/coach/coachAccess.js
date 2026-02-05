export function getCoachAccessState({ hasKey, keyStatus }) {
  if (!hasKey) {
    return {
      canChat: false,
      status: "missing",
      message: "Add your OpenAI API key in Settings to chat.",
    };
  }

  if (keyStatus === "invalid") {
    return {
      canChat: false,
      status: "invalid",
      message: "That API key was rejected. Update it in Settings.",
    };
  }

  return {
    canChat: true,
    status: "ready",
    message: "Key detected. Chat history is saved on this device.",
  };
}
