export const initialCoachState = {
  proposals: [],
  toolEvents: [],
  debug: null,
};

export function coachReducer(state, action) {
  switch (action.type) {
    case "QUEUE_PROPOSALS": {
      return {
        ...state,
        proposals: [...state.proposals, ...(action.payload ?? [])],
      };
    }
    case "UPDATE_PROPOSAL_STATUS": {
      const { id, status, result } = action.payload ?? {};
      return {
        ...state,
        proposals: state.proposals.map((proposal) =>
          proposal.id === id ? { ...proposal, status, result } : proposal
        ),
      };
    }
    case "REMOVE_PROPOSAL": {
      const { id } = action.payload ?? {};
      return {
        ...state,
        proposals: state.proposals.filter((proposal) => proposal.id !== id),
      };
    }
    case "ADD_TOOL_EVENTS": {
      return {
        ...state,
        toolEvents: [...state.toolEvents, ...(action.payload ?? [])],
      };
    }
    case "SET_DEBUG": {
      return { ...state, debug: action.payload ?? null };
    }
    case "CLEAR_EVENTS": {
      return { ...state, toolEvents: [] };
    }
    default:
      return state;
  }
}
