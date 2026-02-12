export const initialActionDraftState = {
  status: "idle",
  error: null,
  draft: null,
  sourceMessageId: null,
  contractVersion: null,
  contextContract: null,
  payloadFingerprint: null,
};

export function actionDraftReducer(state, action) {
  switch (action.type) {
    case "BUILD_START": {
      const clearDraft = action.payload?.clearDraft !== false;
      if (!clearDraft) {
        return {
          ...state,
          status: "building",
          error: null,
        };
      }
      return {
        ...state,
        status: "building",
        error: null,
        draft: null,
        sourceMessageId: null,
        contractVersion: null,
        contextContract: null,
        payloadFingerprint: null,
      };
    }
    case "SET_FROM_MESSAGE": {
      const payload = action.payload ?? {};
      if (payload.actionDraft) {
        return {
          ...state,
          status: "ready",
          error: null,
          draft: payload.actionDraft ?? null,
          sourceMessageId: payload.messageId ?? null,
          contractVersion: payload.contractVersion ?? null,
          contextContract: payload.contextContract ?? null,
          payloadFingerprint: payload.payloadFingerprint ?? null,
        };
      }
      if (payload.error) {
        return {
          ...state,
          status: "error",
          error: String(payload.error),
        };
      }
      if (payload.clearOnEmpty) {
        return {
          ...state,
          status: "idle",
          error: null,
          draft: null,
          sourceMessageId: null,
          contractVersion: null,
          contextContract: null,
          payloadFingerprint: null,
        };
      }
      return {
        ...state,
        status: state.draft ? "ready" : "idle",
        error: null,
      };
    }
    case "SET_ERROR": {
      return {
        ...state,
        status: "error",
        error: String(action.payload?.error ?? "Unable to prepare suggested action."),
      };
    }
    case "UPDATE_DRAFT": {
      const nextDraft = action.payload?.draft ?? state.draft;
      return {
        ...state,
        status: nextDraft ? "ready" : state.status,
        error: null,
        draft: nextDraft,
      };
    }
    case "DISCARD": {
      return {
        ...state,
        status: "idle",
        error: null,
        draft: null,
        sourceMessageId: null,
        contractVersion: null,
        contextContract: state.contextContract,
        payloadFingerprint: state.payloadFingerprint,
      };
    }
    default:
      return state;
  }
}
