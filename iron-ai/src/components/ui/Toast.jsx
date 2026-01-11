export function ToastHost({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone || "info"}`}>
          <span className="toast__message">{toast.message}</span>
          {toast.actionLabel ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.onAction?.();
                onDismiss?.(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="toast__close"
            onClick={() => onDismiss?.(toast.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
