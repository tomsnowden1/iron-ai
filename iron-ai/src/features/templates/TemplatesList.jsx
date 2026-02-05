import { useCallback, useEffect, useRef, useState } from "react";
import { createTemplate, deleteTemplate, listTemplates } from "../../db";
import { BottomSheet, Button, Card, CardBody, Input, Label, PageHeader } from "../../components/ui";

export default function TemplatesList({ onSelectTemplate, onCreateTemplateAndEdit, onNotify }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const inputRef = useRef(null);

  const fetchTemplates = useCallback(async () => {
    setError(null);
    try {
      const data = await listTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        await fetchTemplates();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchTemplates]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchTemplates();
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateTemplate = () => {
    setTemplateName("");
    setCreateModalOpen(true);
  };

  const handleConfirmCreate = async () => {
    const trimmed = templateName.trim();
    if (!trimmed) return;

    try {
      const newTemplateId = await createTemplate({ name: trimmed });
      await fetchTemplates();
      setCreateModalOpen(false);
      setTemplateName("");
      onCreateTemplateAndEdit?.(newTemplateId);
    } catch (err) {
      onNotify?.(`Error creating template: ${err?.message ?? String(err)}`, {
        tone: "error",
      });
    }
  };

  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    setTemplateName("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && templateName.trim()) {
      event.preventDefault();
      handleConfirmCreate();
    }
  };

  // Auto-focus input when modal opens
  useEffect(() => {
    if (createModalOpen && inputRef.current) {
      // Small delay to ensure modal is rendered
      const timeout = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [createModalOpen]);

  const handleDeleteTemplate = async (templateId) => {
    if (!window.confirm("Are you sure you want to delete this template?")) return;

    try {
      await deleteTemplate(templateId);
      // Functional update avoids stale state issues
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (err) {
      onNotify?.(`Error deleting template: ${err?.message ?? String(err)}`, {
        tone: "error",
      });
    }
  };

  const headerActions = (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleRefresh}
        disabled={refreshing || loading}
        loading={refreshing}
      >
        Refresh
      </Button>
      <Button variant="primary" size="sm" onClick={handleCreateTemplate} disabled={loading}>
        Create
      </Button>
    </>
  );

  return (
    <div className="page">
      <PageHeader
        title="Templates"
        subtitle="Build reusable workout plans and launch workouts in seconds."
        actions={headerActions}
      />

      {loading ? (
        <Card>
          <CardBody className="ui-muted">Loading templates…</CardBody>
        </Card>
      ) : null}

      {!loading && error ? (
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-muted">Error: {error?.message ?? String(error)}</div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              loading={refreshing}
            >
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {!loading && !error ? (
        <div className="ui-stack">
          {templates.length === 0 ? (
            <Card>
              <CardBody>
                <div className="empty-state">
                  No templates yet. Create your first template to get started.
                </div>
              </CardBody>
            </Card>
          ) : (
            templates.map((t) => {
              const updatedLabel = t.updatedAt
                ? new Date(t.updatedAt).toLocaleString()
                : "—";

              return (
                <Card key={t.id}>
                  <CardBody className="template-list-item">
                    <div>
                      <div className="ui-row ui-row--between">
                        <div className="ui-strong">{t.name || "(Untitled template)"}</div>
                        <span className="pill">Updated</span>
                      </div>
                      <div className="template-meta">Last updated: {updatedLabel}</div>
                    </div>

                    <div className="ui-row ui-row--wrap">
                      <Button variant="secondary" size="sm" onClick={() => onSelectTemplate?.(t.id)}>
                        Open
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteTemplate(t.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            })
          )}
        </div>
      ) : null}

      <BottomSheet
        open={createModalOpen}
        onClose={handleCloseCreateModal}
        title="Create Template"
        ariaLabel="Create new template"
      >
        <div className="ui-stack">
          <div>
            <Label htmlFor="template-name">Template Name</Label>
            <Input
              id="template-name"
              ref={inputRef}
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Push Day, Leg Day"
            />
          </div>
          <div className="ui-row ui-row--wrap">
            <Button variant="secondary" size="sm" onClick={handleCloseCreateModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmCreate}
              disabled={!templateName.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
