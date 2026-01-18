export const initialActionDraftState = {
  draft: null,
  sourceMessageId: null,
  contractVersion: null,
  contextContract: null,
  payloadFingerprint: null,
};

export function actionDraftReducer(state, action) {
  switch (action.type) {
    case "SET_FROM_MESSAGE": {
      const payload = action.payload ?? {};
      if (!payload.actionDraft) {
        return {
          ...state,
          draft: null,
          sourceMessageId: null,
          contractVersion: null,
          contextContract: null,
          payloadFingerprint: null,
        };
      }
      return {
        ...state,
        draft: payload.actionDraft ?? null,
        sourceMessageId: payload.messageId ?? null,
        contractVersion: payload.contractVersion ?? null,
        contextContract: payload.contextContract ?? null,
        payloadFingerprint: payload.payloadFingerprint ?? null,
      };
    }
    case "UPDATE_DRAFT": {
      return {
        ...state,
        draft: action.payload?.draft ?? state.draft,
      };
    }
    case "DISCARD": {
      return {
        ...state,
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
