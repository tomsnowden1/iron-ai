import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Dumbbell } from "lucide-react";

import {
  createWorkoutSpace,
  db,
  deleteWorkoutSpace,
  getAllExercises,
  getTemplateWithDetails,
  getWorkoutSpaceById,
  listEquipment,
  listTemplates,
  listWorkoutSpaces,
  setActiveWorkoutSpace,
  updateWorkoutSpace,
} from "../../db";
import { Button, Card, CardBody, CardFooter, CardHeader, Input, Label, PageHeader } from "../../components/ui";
import { EQUIPMENT_CATEGORIES, getEquipmentMap } from "../../equipment/catalog";
import EquipmentChecklist from "../../equipment/EquipmentChecklist";
import { getTemplateCompatibility } from "../../equipment/engine";
import { isSpaceExpired, resolveActiveSpace, sortSpacesByName } from "../../workoutSpaces/logic";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  equipmentIds: [],
  isDefault: false,
  isTemporary: false,
  expiresAt: "",
};

function formatDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function equipmentCount(equipmentIds) {
  return (equipmentIds ?? []).filter((id) => id !== "bodyweight").length;
}

function statusLabel(status) {
  if (status === "full") return "Fully compatible";
  if (status === "needs_substitutions") return "Needs substitutions";
  return "Not compatible";
}

function statusTone(status) {
  if (status === "full") return "";
  if (status === "needs_substitutions") return "pill--muted";
  return "pill--danger";
}

function formatMissingList(missingEquipment) {
  if (!missingEquipment?.length) return "";
  const list = missingEquipment.slice(0, 3);
  const remainder = missingEquipment.length - list.length;
  return remainder > 0 ? `${list.join(", ")} +${remainder} more` : list.join(", ");
}

function GymsList({ onBack, onOpenDetail, onCreate, onNotify }) {
  const spaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const activeSpace = useMemo(
    () => resolveActiveSpace(spaces ?? [], settings?.active_space_id ?? null),
    [settings?.active_space_id, spaces]
  );

  const sortedSpaces = useMemo(
    () => (spaces ? sortSpacesByName(spaces) : []),
    [spaces]
  );

  return (
    <div className="page">
      <PageHeader
        title="Gyms"
        subtitle="Create and manage your workout spaces."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={onCreate}>
              Create gym
            </Button>
          </>
        }
      />

      {sortedSpaces.length === 0 ? (
        <Card>
          <CardBody>
            <div className="empty-state">
              No gyms yet. Create your first gym to get started.
            </div>
            <div className="ui-row ui-row--wrap">
              <Button variant="primary" size="sm" onClick={onCreate}>
                Create your first gym
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="ui-stack">
          {sortedSpaces.map((space) => {
            const active = activeSpace?.id === space.id;
            const expired = isSpaceExpired(space);
            const count = equipmentCount(space.equipmentIds);
            return (
              <Card key={space.id}>
                <CardHeader>
                  <div className="ui-stack">
                    <div className="ui-row ui-row--between ui-row--wrap">
                      <div className="ui-strong">{space.name ?? "Untitled Gym"}</div>
                      <div className="ui-row ui-row--wrap">
                        {active ? <span className="pill">Active</span> : null}
                        {space.isTemporary ? (
                          <span className="pill pill--muted">Temporary</span>
                        ) : null}
                        {expired ? <span className="pill pill--muted">Expired</span> : null}
                      </div>
                    </div>
                    {space.description ? (
                      <div className="template-meta">{space.description}</div>
                    ) : null}
                  </div>
                </CardHeader>
                <CardBody className="ui-stack">
                  <div className="ui-row ui-row--between ui-row--wrap">
                    <div className="template-meta">
                      Equipment: {count ? `${count} selected` : "None selected"}
                    </div>
                    {space.expiresAt ? (
                      <div className="template-meta">
                        Expires: {formatDateInput(space.expiresAt)}
                      </div>
                    ) : null}
                  </div>
                  {count === 0 ? (
                    <div className="space-warning">
                      This gym has no equipment selected yet.
                    </div>
                  ) : null}
                  <div className="ui-row ui-row--wrap">
                    <Button variant="secondary" size="sm" onClick={() => onOpenDetail(space.id)}>
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await setActiveWorkoutSpace(space.id);
                          onNotify?.("Active gym updated ✅", { tone: "success" });
                        } catch (err) {
                          onNotify?.(err?.message ?? "Unable to set active gym.", {
                            tone: "error",
                          });
                        }
                      }}
                      disabled={active}
                    >
                      {active ? "Active" : "Set as active"}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GymForm({ mode, spaceId, onCancel, onSaved, onNotify }) {
  const space = useLiveQuery(() => (spaceId ? getWorkoutSpaceById(spaceId) : null), [spaceId]);
  const equipment = useLiveQuery(() => listEquipment(), []);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "edit" || mode === "duplicate") {
      if (!space) return;
      setDraft({
        name:
          mode === "duplicate"
            ? `${space.name ?? "Gym"} Copy`
            : space.name ?? "",
        description: space.description ?? "",
        equipmentIds: Array.isArray(space.equipmentIds) ? space.equipmentIds : [],
        isDefault: mode === "edit" ? Boolean(space.isDefault) : false,
        isTemporary: Boolean(space.isTemporary),
        expiresAt: formatDateInput(space.expiresAt),
      });
      setSearch("");
      return;
    }
    setDraft(EMPTY_DRAFT);
    setSearch("");
  }, [mode, space]);

  const toggleEquipment = (equipmentId) => {
    if (equipmentId === "bodyweight") return;
    setDraft((prev) => {
      const existing = new Set(prev.equipmentIds ?? []);
      if (existing.has(equipmentId)) {
        existing.delete(equipmentId);
      } else {
        existing.add(equipmentId);
      }
      return { ...prev, equipmentIds: Array.from(existing) };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === "edit") {
        await updateWorkoutSpace(spaceId, {
          name: draft.name,
          description: draft.description,
          equipmentIds: draft.equipmentIds,
          isDefault: draft.isDefault,
          isTemporary: draft.isTemporary,
          expiresAt: draft.isTemporary ? draft.expiresAt || null : null,
        });
        onNotify?.("Gym updated ✅", { tone: "success" });
        onSaved?.(spaceId);
      } else {
        const id = await createWorkoutSpace({
          name: draft.name,
          description: draft.description,
          equipmentIds: draft.equipmentIds,
          isDefault: draft.isDefault,
          isTemporary: draft.isTemporary,
          expiresAt: draft.isTemporary ? draft.expiresAt || null : null,
        });
        onNotify?.("Gym created ✅", { tone: "success" });
        onSaved?.(id);
      }
    } catch (err) {
      onNotify?.(err?.message ?? "Unable to save gym.", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const equipmentTotal = equipmentCount(draft.equipmentIds);
  const showNameWarning = !draft.name.trim();

  return (
    <div className="page">
      <PageHeader
        title={
          mode === "edit"
            ? "Edit gym"
            : mode === "duplicate"
              ? "Duplicate gym"
              : "Create gym"
        }
        subtitle="Define equipment and details for this gym."
        actions={
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Back
          </Button>
        }
      />

      <Card>
        <CardBody className="ui-stack">
          <div>
            <Label htmlFor="gym-name">Name</Label>
            <Input
              id="gym-name"
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Downtown Gym"
            />
            {showNameWarning ? (
              <div className="template-meta">
                Name is required. This will save as &quot;New Space&quot; if left blank.
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="gym-description">Description</Label>
            <textarea
              id="gym-description"
              className="ui-input ui-textarea"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional details or address."
            />
          </div>
          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-strong">Temporary gym</div>
              <div className="template-meta">Use for travel or short-term setups.</div>
            </div>
            <Button
              variant={draft.isTemporary ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() =>
                setDraft((prev) => ({ ...prev, isTemporary: !prev.isTemporary }))
              }
            >
              {draft.isTemporary ? "On" : "Off"}
            </Button>
          </div>
          {draft.isTemporary ? (
            <div>
              <Label htmlFor="gym-expires">Expires on</Label>
              <Input
                id="gym-expires"
                type="date"
                value={draft.expiresAt}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, expiresAt: e.target.value }))
                }
              />
            </div>
          ) : null}
          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-strong">Set as default</div>
              <div className="template-meta">Used when no active gym is selected.</div>
            </div>
            <Button
              variant={draft.isDefault ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, isDefault: !prev.isDefault }))}
            >
              {draft.isDefault ? "Yes" : "No"}
            </Button>
          </div>
          <div>
            <Label>Equipment</Label>
            <EquipmentChecklist
              equipment={equipment ?? []}
              selectedIds={draft.equipmentIds ?? []}
              onToggle={toggleEquipment}
              search={search}
              onSearchChange={setSearch}
            />
            {equipmentTotal === 0 ? (
              <div className="space-warning">No equipment selected yet.</div>
            ) : null}
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            loading={saving}
            className="w-full"
          >
            Save gym
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function GymDetail({ spaceId, onBack, onEdit, onDuplicate, onLaunchCoach, onNotify }) {
  const space = useLiveQuery(() => (spaceId ? getWorkoutSpaceById(spaceId) : null), [spaceId]);
  const spaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const equipment = useLiveQuery(() => listEquipment(), []);
  const templates = useLiveQuery(() => listTemplates(), []);
  const allExercises = useLiveQuery(() => getAllExercises(), []);
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const [templateBundles, setTemplateBundles] = useState([]);
  const [equipmentSearch, setEquipmentSearch] = useState("");

  useEffect(() => {
    let active = true;
    if (!templates?.length) {
      setTemplateBundles([]);
      return () => {
        active = false;
      };
    }
    Promise.all(templates.map((tpl) => getTemplateWithDetails(tpl.id))).then((bundles) => {
      if (!active) return;
      setTemplateBundles(bundles.filter(Boolean));
    });
    return () => {
      active = false;
    };
  }, [templates]);

  const equipmentMap = useMemo(
    () => getEquipmentMap(equipment ?? []),
    [equipment]
  );
  const activeSpace = useMemo(
    () => resolveActiveSpace(spaces ?? [], settings?.active_space_id ?? null),
    [settings?.active_space_id, spaces]
  );
  const isActive = Boolean(activeSpace && space && activeSpace.id === space.id);
  const expired = isSpaceExpired(space);

  const equipmentIds = space?.equipmentIds;
  const equipmentList = useMemo(() => {
    if (!equipmentIds?.length) return [];
    return equipmentIds
      .map((id) => equipmentMap.get(id))
      .filter(Boolean)
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  }, [equipmentIds, equipmentMap]);
  const equipmentFiltered = useMemo(() => {
    const lowered = equipmentSearch.trim().toLowerCase();
    if (!lowered) return equipmentList;
    return equipmentList.filter((item) => {
      const name = String(item?.name ?? "").toLowerCase();
      return name.includes(lowered);
    });
  }, [equipmentList, equipmentSearch]);
  const equipmentGrouped = useMemo(() => {
    const byCategory = new Map();
    equipmentFiltered.forEach((item) => {
      const key = item?.category ?? "other";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(item);
    });
    return byCategory;
  }, [equipmentFiltered]);
  const showEquipmentSearch = equipmentList.length > 12;
  const equipmentTotal = equipmentCount(space?.equipmentIds);
  const templatesLoading =
    templates == null || allExercises == null || equipment == null;

  const compatibilityList = useMemo(() => {
    if (!space || !templateBundles?.length) return [];
    return templateBundles.map((bundle) => {
      const template = bundle?.template;
      if (!template) return null;
      const compatibility = getTemplateCompatibility({
        items: bundle.items ?? [],
        spaceEquipmentIds: space.equipmentIds ?? [],
        allExercises: allExercises ?? [],
        equipmentMap,
      });
      return {
        template,
        compatibility,
      };
    }).filter(Boolean);
  }, [allExercises, equipmentMap, space, templateBundles]);

  if (!space) {
    return (
      <div className="page">
        <PageHeader
          title="Gym"
          subtitle="This gym could not be found."
          actions={
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          }
        />
        <Card>
          <CardBody>
            <div className="empty-state">Gym not found. It may have been deleted.</div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Gym"
        subtitle="Review equipment and template compatibility."
        actions={
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        }
      />

      <Card>
        <CardBody className="gym-header">
          <div className="gym-header__icon">
            <Dumbbell size={18} />
          </div>
          <div className="gym-header__content">
            <div className="ui-row ui-row--between ui-row--wrap">
              <div className="ui-strong">{space.name ?? "Untitled Gym"}</div>
              <div className="ui-row ui-row--wrap">
                {isActive ? <span className="pill">Active</span> : null}
                {space.isTemporary ? (
                  <span className="pill pill--muted">Temporary</span>
                ) : null}
                {expired ? <span className="pill pill--muted">Expired</span> : null}
              </div>
            </div>
            {space.description ? (
              <div className="template-meta">{space.description}</div>
            ) : null}
            {space.expiresAt ? (
              <div className="template-meta">Expires: {formatDateInput(space.expiresAt)}</div>
            ) : null}
          </div>
        </CardBody>
        <CardFooter className="ui-row ui-row--wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await setActiveWorkoutSpace(space.id);
                onNotify?.("Active gym updated ✅", { tone: "success" });
              } catch (err) {
                onNotify?.(err?.message ?? "Unable to set active gym.", { tone: "error" });
              }
            }}
            disabled={isActive}
          >
            {isActive ? "Active gym" : "Set as active gym"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              try {
                await setActiveWorkoutSpace(space.id);
                onLaunchCoach?.({
                  source: "gym_detail",
                  gymId: space.id,
                  gymName: space.name ?? "Gym",
                });
              } catch (err) {
                onNotify?.(err?.message ?? "Unable to launch Coach.", { tone: "error" });
              }
            }}
          >
            Load into Coach for workout suggestions
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Equipment inventory</div>
        </CardHeader>
        <CardBody className="ui-stack">
          {showEquipmentSearch ? (
            <Input
              type="search"
              placeholder="Search equipment"
              value={equipmentSearch}
              onChange={(e) => setEquipmentSearch(e.target.value)}
            />
          ) : null}
          {equipmentTotal === 0 ? (
            <div className="space-warning">No equipment selected for this gym.</div>
          ) : null}
          {EQUIPMENT_CATEGORIES.map((category) => {
            const items = equipmentGrouped.get(category.id) ?? [];
            if (!items.length) return null;
            return (
              <div key={category.id} className="ui-stack">
                <div className="template-meta">{category.label}</div>
                <div className="equipment-pills">
                  {items.map((item) => (
                    <span key={item.id} className="equipment-pill">
                      {item.name}
                      {item.id === "bodyweight" ? (
                        <span className="pill pill--muted">Always</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {!equipmentFiltered.length && equipmentTotal > 0 ? (
            <div className="template-meta">No equipment matches that search.</div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Templates for this gym</div>
        </CardHeader>
        <CardBody className="ui-stack">
          {templatesLoading ? (
            <div className="ui-muted">Loading templates…</div>
          ) : !compatibilityList.length ? (
            <div className="empty-state">No templates yet. Create one to see compatibility.</div>
          ) : (
            compatibilityList.map(({ template, compatibility }) => {
              const missingSummary = formatMissingList(compatibility.missingEquipment);
              return (
                <div key={template.id} className="compat-item">
                  <div className="compat-item__main">
                    <div className="ui-row ui-row--between ui-row--wrap">
                      <div className="ui-strong">{template.name ?? "Untitled Template"}</div>
                      <span className={`pill ${statusTone(compatibility.status)}`.trim()}>
                        {statusLabel(compatibility.status)}
                      </span>
                    </div>
                    {missingSummary ? (
                      <div className="template-meta">Missing: {missingSummary}</div>
                    ) : (
                      <div className="template-meta">All required equipment available.</div>
                    )}
                  </div>
                  <div className="compat-item__actions">
                    <Button variant="secondary" size="sm" disabled>
                      Adapt template
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="ui-section-title">Manage gym</div>
        </CardHeader>
        <CardBody className="ui-row ui-row--wrap">
          <Button variant="secondary" size="sm" onClick={() => onEdit(space.id)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDuplicate(space.id)}>
            Duplicate
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!window.confirm("Delete this gym?")) return;
              try {
                await deleteWorkoutSpace(space.id);
                onNotify?.("Gym deleted ✅", { tone: "success" });
                onBack?.();
              } catch (err) {
                onNotify?.(err?.message ?? "Unable to delete gym.", { tone: "error" });
              }
            }}
          >
            Delete
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

export default function GymsView({ onBack, onLaunchCoach, onNotify, initialView }) {
  const [view, setView] = useState(
    () => initialView ?? { type: "list", spaceId: null, mode: "create" }
  );

  useEffect(() => {
    if (!initialView) return;
    setView(initialView);
  }, [initialView]);

  if (view.type === "list") {
    return (
      <GymsList
        onBack={onBack}
        onOpenDetail={(spaceId) => setView({ type: "detail", spaceId })}
        onCreate={() => setView({ type: "form", mode: "create" })}
        onNotify={onNotify}
      />
    );
  }

  if (view.type === "form") {
    return (
      <GymForm
        mode={view.mode}
        spaceId={view.spaceId}
        onCancel={() =>
          setView(view.spaceId ? { type: "detail", spaceId: view.spaceId } : { type: "list" })
        }
        onSaved={(spaceId) => setView({ type: "detail", spaceId })}
        onNotify={onNotify}
      />
    );
  }

  return (
    <GymDetail
      spaceId={view.spaceId}
      onBack={() => setView({ type: "list" })}
      onEdit={(spaceId) => setView({ type: "form", mode: "edit", spaceId })}
      onDuplicate={(spaceId) => setView({ type: "form", mode: "duplicate", spaceId })}
      onLaunchCoach={onLaunchCoach}
      onNotify={onNotify}
    />
  );
}
