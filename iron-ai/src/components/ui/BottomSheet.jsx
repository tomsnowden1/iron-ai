import { useEffect } from "react";

export default function BottomSheet({ open, onClose, title, children, ariaLabel }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="bottom-sheet" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button
        type="button"
        className="bottom-sheet__backdrop"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="bottom-sheet__panel" role="document">
        <div className="bottom-sheet__header">
          <div className="bottom-sheet__title">{title}</div>
          <button type="button" className="bottom-sheet__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="bottom-sheet__content">{children}</div>
      </div>
    </div>
  );
}
