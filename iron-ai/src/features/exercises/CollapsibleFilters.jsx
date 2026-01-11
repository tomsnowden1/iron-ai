import { useEffect, useId, useState } from "react";

export default function CollapsibleFilters({
  label = "Filters",
  activeCount = 0,
  defaultExpanded = false,
  storageKey,
  children,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  const labelText = activeCount > 0 ? `${label} (${activeCount})` : label;

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    const saved = window.sessionStorage.getItem(storageKey);
    if (saved === null) return;
    setExpanded(saved === "true");
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    window.sessionStorage.setItem(storageKey, String(expanded));
  }, [expanded, storageKey]);

  if (typeof children !== "function") return null;

  return children({
    expanded,
    label: labelText,
    panelId,
    toggle: () => setExpanded((prev) => !prev),
    setExpanded,
  });
}
