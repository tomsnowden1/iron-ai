import { getCoachKeyMode } from "../../config/coachKeyMode";

export function getCoachAccessState({ hasKey, keyStatus, keyMode = getCoachKeyMode() }) {
  if (keyMode === "server") {
    return {
      canChat: true,
      status: "ready",
      keyMode,
      message: "Testing mode: using server key.",
    };
  }

  if (!hasKey) {
    return {
      canChat: false,
      status: "missing",
      keyMode,
      message: "Add your OpenAI API key in Settings to chat.",
    };
  }

  if (keyStatus === "invalid") {
    return {
      canChat: false,
      status: "invalid",
      keyMode,
      message: "That API key was rejected. Update it in Settings.",
    };
  }

  return {
    canChat: true,
    status: "ready",
    keyMode,
    message: "Key detected. Chat history is saved on this device.",
  };
}
