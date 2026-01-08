import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  createWorkoutSpace,
  deleteWorkoutSpace,
  duplicateWorkoutSpace,
  listEquipment,
  listWorkoutSpaces,
  setDefaultWorkoutSpace,
  updateWorkoutSpace,
} from "../../db";
import { Button, Card, CardBody, CardHeader, Input, Label } from "../../components/ui";
import EquipmentChecklist from "../../equipment/EquipmentChecklist";
import { isSpaceExpired, sortSpacesByName } from "../../workoutSpaces/logic";

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

export default function WorkoutSpacesManager({ onNotify }) {
  const spaces = useLiveQuery(() => listWorkoutSpaces(), []);
  const equipment = useLiveQuery(() => listEquipment(), []);

  const sortedSpaces = useMemo(
    () => (spaces ? sortSpacesByName(spaces) : []),
    [spaces]
  );

  const [createDraft, setCreateDraft] = useState(EMPTY_DRAFT);
  const [createSearch, setCreateSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT);
  const [editSearch, setEditSearch] = useState("");

  const beginEdit = (space) => {
    setEditingId(space.id);
    setEditDraft({
      name: space.name ?? "",
      description: space.description ?? "",
      equipmentIds: Array.isArray(space.equipmentIds) ? space.equipmentIds : [],
      isDefault: Boolean(space.isDefault),
      isTemporary: Boolean(space.isTemporary),
      expiresAt: formatDateInput(space.expiresAt),
    });
    setEditSearch("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(EMPTY_DRAFT);
    setEditSearch("");
  };

  const handleToggleEquipment = (draftSetter) => (equipmentId) => {
    if (equipmentId === "bodyweight") return;
    draftSetter((prev) => {
      const existing = new Set(prev.equipmentIds ?? []);
      if (existing.has(equipmentId)) {
        existing.delete(equipmentId);
      } else {
        existing.add(equipmentId);
      }
      return { ...prev, equipmentIds: Array.from(existing) };
    });
  };

  const handleCreate = async () => {
    try {
      await createWorkoutSpace({
        name: createDraft.name,
        description: createDraft.description,
        equipmentIds: createDraft.equipmentIds,
        isDefault: createDraft.isDefault,
        isTemporary: createDraft.isTemporary,
        expiresAt: createDraft.isTemporary ? createDraft.expiresAt || null : null,
      });
      setCreateDraft(EMPTY_DRAFT);
      setCreateSearch("");
      onNotify?.("Workout space created ✅", { tone: "success" });
    } catch (err) {
      onNotify?.(err?.message ?? "Unable to create space.", { tone: "error" });
    }
  };

  const handleSaveEdit = async () => {
    try {
      await updateWorkoutSpace(editingId, {
        name: editDraft.name,
        description: editDraft.description,
        equipmentIds: editDraft.equipmentIds,
        isDefault: editDraft.isDefault,
        isTemporary: editDraft.isTemporary,
        expiresAt: editDraft.isTemporary ? editDraft.expiresAt || null : null,
      });
      onNotify?.("Workout space updated ✅", { tone: "success" });
      cancelEdit();
    } catch (err) {
      onNotify?.(err?.message ?? "Unable to update space.", { tone: "error" });
    }
  };

  const handleDelete = async (spaceId) => {
    if (!window.confirm("Delete this workout space?")) return;
    await deleteWorkoutSpace(spaceId);
  };

  return (
    <div className="ui-stack">
      <Card>
        <CardHeader>
          <div className="ui-section-title">Workout Spaces</div>
        </CardHeader>
        <CardBody className="ui-stack">
          <div>
            <Label htmlFor="space-name">Space name</Label>
            <Input
              id="space-name"
              value={createDraft.name}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Home Gym"
            />
          </div>
          <div>
            <Label htmlFor="space-description">Description</Label>
            <textarea
              id="space-description"
              className="ui-input ui-textarea"
              rows={2}
              value={createDraft.description}
              onChange={(e) =>
                setCreateDraft((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Optional details or address."
            />
          </div>
          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-strong">Temporary space</div>
              <div className="template-meta">Use for travel or short-term setups.</div>
            </div>
            <Button
              variant={createDraft.isTemporary ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() =>
                setCreateDraft((prev) => ({ ...prev, isTemporary: !prev.isTemporary }))
              }
            >
              {createDraft.isTemporary ? "On" : "Off"}
            </Button>
          </div>
          {createDraft.isTemporary ? (
            <div>
              <Label htmlFor="space-expires">Expires on</Label>
              <Input
                id="space-expires"
                type="date"
                value={createDraft.expiresAt}
                onChange={(e) =>
                  setCreateDraft((prev) => ({ ...prev, expiresAt: e.target.value }))
                }
              />
            </div>
          ) : null}
          <div className="ui-row ui-row--between ui-row--wrap">
            <div>
              <div className="ui-strong">Set as default</div>
              <div className="template-meta">Used when no active space is selected.</div>
            </div>
            <Button
              variant={createDraft.isDefault ? "primary" : "secondary"}
              size="sm"
              type="button"
              onClick={() =>
                setCreateDraft((prev) => ({ ...prev, isDefault: !prev.isDefault }))
              }
            >
              {createDraft.isDefault ? "Yes" : "No"}
            </Button>
          </div>
          <div>
            <Label>Equipment</Label>
            <EquipmentChecklist
              equipment={equipment ?? []}
              selectedIds={createDraft.equipmentIds ?? []}
              onToggle={handleToggleEquipment(setCreateDraft)}
              search={createSearch}
              onSearchChange={setCreateSearch}
            />
            {(createDraft.equipmentIds ?? []).filter((id) => id !== "bodyweight").length ===
            0 ? (
              <div className="template-meta">No equipment selected yet.</div>
            ) : null}
          </div>
          <Button variant="primary" size="md" onClick={handleCreate} className="w-full">
            Create space
          </Button>
        </CardBody>
      </Card>

      {sortedSpaces.length === 0 ? (
        <Card>
          <CardBody>
            <div className="empty-state">No workout spaces yet. Create one above.</div>
          </CardBody>
        </Card>
      ) : (
        <div className="ui-stack">
          {sortedSpaces.map((space) => {
            const expired = isSpaceExpired(space);
            const equipmentCount = (space.equipmentIds ?? []).filter(
              (id) => id !== "bodyweight"
            ).length;
            return (
              <Card key={space.id}>
                <CardHeader>
                  <div className="ui-stack">
                    <div className="ui-strong">{space.name ?? "Untitled Space"}</div>
                    {space.description ? (
                      <div className="template-meta">{space.description}</div>
                    ) : null}
                  </div>
                  <div className="ui-row ui-row--wrap">
                    {space.isDefault ? <span className="pill">Default</span> : null}
                    {space.isTemporary ? (
                      <span className="pill pill--muted">Temporary</span>
                    ) : null}
                    {expired ? <span className="pill pill--muted">Expired</span> : null}
                  </div>
                </CardHeader>
                <CardBody className="ui-stack">
                  <div className="ui-row ui-row--between ui-row--wrap">
                    <div className="template-meta">
                      Equipment: {equipmentCount || "None"} selected
                    </div>
                    {space.expiresAt ? (
                      <div className="template-meta">Expires: {formatDateInput(space.expiresAt)}</div>
                    ) : null}
                  </div>
                  {equipmentCount === 0 ? (
                    <div className="space-warning">No equipment selected for this space.</div>
                  ) : null}
                  <div className="ui-row ui-row--wrap">
                    <Button variant="secondary" size="sm" onClick={() => beginEdit(space)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await duplicateWorkoutSpace(space.id);
                          onNotify?.("Space duplicated ✅", { tone: "success" });
                        } catch (err) {
                          onNotify?.(err?.message ?? "Unable to duplicate space.", {
                            tone: "error",
                          });
                        }
                      }}
                    >
                      Duplicate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await setDefaultWorkoutSpace(space.id);
                          onNotify?.("Default space updated ✅", { tone: "success" });
                        } catch (err) {
                          onNotify?.(err?.message ?? "Unable to set default space.", {
                            tone: "error",
                          });
                        }
                      }}
                    >
                      Set default
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(space.id)}>
                      Delete
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {editingId ? (
        <Card>
          <CardHeader>
            <div className="ui-section-title">Edit space</div>
          </CardHeader>
          <CardBody className="ui-stack">
            <div>
              <Label htmlFor="space-edit-name">Space name</Label>
              <Input
                id="space-edit-name"
                value={editDraft.name}
                onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="space-edit-description">Description</Label>
              <textarea
                id="space-edit-description"
                className="ui-input ui-textarea"
                rows={2}
                value={editDraft.description}
                onChange={(e) =>
                  setEditDraft((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>
            <div className="ui-row ui-row--between ui-row--wrap">
              <div>
                <div className="ui-strong">Temporary space</div>
                <div className="template-meta">Use for travel or short-term setups.</div>
              </div>
              <Button
                variant={editDraft.isTemporary ? "primary" : "secondary"}
                size="sm"
                type="button"
                onClick={() =>
                  setEditDraft((prev) => ({ ...prev, isTemporary: !prev.isTemporary }))
                }
              >
                {editDraft.isTemporary ? "On" : "Off"}
              </Button>
            </div>
            {editDraft.isTemporary ? (
              <div>
                <Label htmlFor="space-edit-expires">Expires on</Label>
                <Input
                  id="space-edit-expires"
                  type="date"
                  value={editDraft.expiresAt}
                  onChange={(e) =>
                    setEditDraft((prev) => ({ ...prev, expiresAt: e.target.value }))
                  }
                />
              </div>
            ) : null}
            <div className="ui-row ui-row--between ui-row--wrap">
              <div>
                <div className="ui-strong">Default space</div>
                <div className="template-meta">Used when no active space is selected.</div>
              </div>
              <Button
                variant={editDraft.isDefault ? "primary" : "secondary"}
                size="sm"
                type="button"
                onClick={() =>
                  setEditDraft((prev) => ({ ...prev, isDefault: !prev.isDefault }))
                }
              >
                {editDraft.isDefault ? "Yes" : "No"}
              </Button>
            </div>
            <div>
              <Label>Equipment</Label>
              <EquipmentChecklist
                equipment={equipment ?? []}
                selectedIds={editDraft.equipmentIds ?? []}
                onToggle={handleToggleEquipment(setEditDraft)}
                search={editSearch}
                onSearchChange={setEditSearch}
              />
            </div>
            <div className="ui-row ui-row--wrap">
              <Button variant="primary" size="sm" onClick={handleSaveEdit}>
                Save changes
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
