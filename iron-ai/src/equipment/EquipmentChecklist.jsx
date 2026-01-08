import { useMemo } from "react";

import { Input } from "../components/ui";
import { EQUIPMENT_CATEGORIES } from "./catalog";

export default function EquipmentChecklist({
  equipment,
  selectedIds,
  onToggle,
  search,
  onSearchChange,
}) {
  const lowered = String(search ?? "").trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lowered) return equipment;
    return equipment.filter((item) => {
      const name = String(item.name ?? "").toLowerCase();
      const aliasMatch = Array.isArray(item.aliases)
        ? item.aliases.some((alias) => String(alias).toLowerCase().includes(lowered))
        : false;
      return name.includes(lowered) || aliasMatch;
    });
  }, [equipment, lowered]);

  const grouped = useMemo(() => {
    const byCategory = new Map();
    filtered.forEach((item) => {
      const key = item.category ?? "other";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(item);
    });
    return byCategory;
  }, [filtered]);

  return (
    <div className="space-equipment">
      <Input
        type="search"
        placeholder="Search equipment"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {EQUIPMENT_CATEGORIES.map((category) => {
        const items = grouped.get(category.id) ?? [];
        if (!items.length) return null;
        return (
          <div key={category.id} className="space-equipment__group">
            <div className="template-meta">{category.label}</div>
            <div className="space-equipment__list">
              {items.map((item) => {
                const isBodyweight = item.id === "bodyweight";
                return (
                  <label key={item.id} className="space-equipment__item">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id) || isBodyweight}
                      onChange={() => onToggle(item.id)}
                      disabled={isBodyweight}
                    />
                    <span>{item.name}</span>
                    {isBodyweight ? <span className="pill pill--muted">Always</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {!filtered.length ? (
        <div className="template-meta">No equipment matches that search.</div>
      ) : null}
    </div>
  );
}
