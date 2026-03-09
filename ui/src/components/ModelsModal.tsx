import React, { useState, useEffect, useCallback } from "react";
import Modal from "./Modal";
import { useI18n } from "../i18n";
import {
  customModelsApi,
  CustomModel,
  CreateCustomModelRequest,
  TestCustomModelRequest,
} from "../services/api";

interface ModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelsChanged?: () => void;
}

type ProviderType = "anthropic" | "openai" | "openai-responses" | "gemini" | "vertex";

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  vertex: ":global",
};

const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI (Chat API)",
  "openai-responses": "OpenAI (Responses API)",
  gemini: "Google Gemini",
  vertex: "Google Vertex AI",
};

const DEFAULT_MODELS: Record<ProviderType, { name: string; model_name: string }[]> = {
  anthropic: [
    { name: "Claude Sonnet 4.6", model_name: "claude-sonnet-4-6" },
    { name: "Claude Opus 4.6", model_name: "claude-opus-4-6" },
    { name: "Claude Haiku 4.5", model_name: "claude-haiku-4-5" },
  ],
  openai: [{ name: "GPT-5.2", model_name: "gpt-5.2" }],
  "openai-responses": [{ name: "GPT-5.2 Codex", model_name: "gpt-5.2-codex" }],
  gemini: [
    { name: "Gemini 3 Pro Preview", model_name: "gemini-3-pro-preview" },
    { name: "Gemini 3 Flash Preview", model_name: "gemini-3-flash-preview" },
    { name: "Gemini 2.5 Pro", model_name: "gemini-2.5-pro" },
    { name: "Gemini 2.5 Flash", model_name: "gemini-2.5-flash" },
    { name: "Gemini 2.0 Flash Exp", model_name: "gemini-2.0-flash-exp" },
    { name: "Gemini 2.0 Flash", model_name: "gemini-2.0-flash" },
    { name: "Gemini 1.5 Pro", model_name: "gemini-1.5-pro" },
    { name: "Gemini 1.5 Pro Latest", model_name: "gemini-1.5-pro-latest" },
    { name: "Gemini 1.5 Flash", model_name: "gemini-1.5-flash" },
    { name: "Gemini 1.5 Flash Latest", model_name: "gemini-1.5-flash-latest" },
  ],
  // Vertex AI models are always effectively custom since we require BYOK
  vertex: [],
};

// Built-in model info from init data
interface BuiltInModel {
  id: string;
  display_name?: string;
  source?: string;
  ready: boolean;
}

interface FormData {
  display_name: string;
  provider_type: ProviderType;
  endpoint: string;
  endpoint_custom: boolean;
  vertex_endpoint_mode: "project-region" | "custom";
  vertex_project: string;
  vertex_region: string;
  api_key: string;
  model_name: string;
  max_tokens: number;
  tags: string; // Comma-separated tags
}

const emptyForm: FormData = {
  display_name: "",
  provider_type: "anthropic",
  endpoint: DEFAULT_ENDPOINTS.anthropic,
  endpoint_custom: false,
  vertex_endpoint_mode: "project-region",
  vertex_project: "",
  vertex_region: "global",
  api_key: "",
  model_name: "",
  max_tokens: 200000,
  tags: "",
};

function ModelsModal({ isOpen, onClose, onModelsChanged }: ModelsModalProps) {
  const { t } = useI18n();
  const [models, setModels] = useState<CustomModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builtInModels, setBuiltInModels] = useState<BuiltInModel[]>([]);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  // Test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Tooltip state
  const [showTagsTooltip, setShowTagsTooltip] = useState(false);

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await customModelsApi.getCustomModels();
      setModels(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadModels();
      // Get built-in models from init data (those with non-custom source)
      const initData = window.__SHELLEY_INIT__;
      if (initData?.models) {
        const builtIn = initData.models.filter(
          (m: BuiltInModel) => m.source && m.source !== "custom",
        );
        setBuiltInModels(builtIn);
      }
    }
  }, [isOpen, loadModels]);

  const handleProviderChange = (provider: ProviderType) => {
    const isVertex = provider === "vertex";
    setForm((prev) => ({
      ...prev,
      provider_type: provider,
      endpoint_custom: isVertex ? false : prev.endpoint_custom,
      vertex_endpoint_mode: isVertex ? "project-region" : prev.vertex_endpoint_mode,
      vertex_project: isVertex ? "" : prev.vertex_project,
      vertex_region: isVertex ? "global" : prev.vertex_region,
      endpoint: isVertex
        ? ":global"
        : prev.endpoint_custom
          ? prev.endpoint
          : DEFAULT_ENDPOINTS[provider],
    }));
  };

  const handleEndpointModeChange = (custom: boolean) => {
    setForm((prev) => {
      if (prev.provider_type === "vertex") {
        const mode = custom ? "custom" : "project-region";
        const endpoint = custom
          ? (prev.vertex_project && prev.vertex_region
            ? constructVertexURL(prev.vertex_project, prev.vertex_region, prev.model_name || "gemini-3-flash-preview")
            : "")
          : `${prev.vertex_project || ""}:${prev.vertex_region || "global"}`;
        return {
          ...prev,
          vertex_endpoint_mode: mode,
          endpoint,
        };
      }
      return {
        ...prev,
        endpoint_custom: custom,
        endpoint: custom ? "" : DEFAULT_ENDPOINTS[prev.provider_type],
      };
    });
  };

  // Construct full Vertex AI endpoint URL from project/region
  // Note: modelName should NOT include -vertex suffix (that's Shelley's internal ID)
  const constructVertexURL = (project: string, region: string, modelName: string): string => {
    // Strip -vertex suffix if present (Shelley's internal ID vs Google's actual model ID)
    const googleModelName = modelName.replace(/-vertex$/, "");
    if (!project) {
      return "Enter a project ID to see the endpoint URL";
    }
    if (!region) {
      return "Enter a region to see the endpoint URL";
    }
    const location = region;
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${googleModelName}:streamGenerateContent`;
  };

  const handleSelectPresetModel = (preset: { name: string; model_name: string }) => {
    setForm((prev) => ({
      ...prev,
      display_name: preset.name,
      model_name: preset.model_name,
    }));
  };

  const handleTest = async () => {
    // Need model_name always, and either api_key or editing an existing model
    if (!form.model_name) {
      setTestResult({ success: false, message: t("modelNameRequired") });
      return;
    }
    if (!form.api_key && !editingModelId) {
      setTestResult({ success: false, message: t("apiKeyRequired") });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const request: TestCustomModelRequest = {
        model_id: editingModelId || undefined, // Pass model_id to use stored key
        provider_type: form.provider_type,
        endpoint: form.endpoint,
        api_key: form.api_key,
        model_name: form.model_name,
      };
      const result = await customModelsApi.testCustomModel(request);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.display_name || !form.api_key || !form.model_name) {
      setError("Display name, API key, and model name are required");
      return;
    }

    try {
      setError(null);

      const request: CreateCustomModelRequest = {
        display_name: form.display_name,
        provider_type: form.provider_type,
        endpoint: form.endpoint,
        api_key: form.api_key,
        model_name: form.model_name,
        max_tokens: form.max_tokens,
        tags: form.tags,
      };

      if (editingModelId) {
        await customModelsApi.updateCustomModel(editingModelId, request);
      } else {
        await customModelsApi.createCustomModel(request);
      }

      setShowForm(false);
      setEditingModelId(null);
      setForm(emptyForm);
      setTestResult(null);
      await loadModels();
      onModelsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    }
  };

  const handleEdit = (model: CustomModel) => {
    // For vertex, detect mode from endpoint format
    let vertex_endpoint_mode: "project-region" | "custom" = "project-region";
    let vertex_project = "";
    let vertex_region = "global";

    if (model.provider_type === "vertex") {
      const isCustom = model.endpoint.includes("googleapis.com");
      if (isCustom) {
        vertex_endpoint_mode = "custom";
      } else {
        // Parse project:region format (skip if it's just ":global" default)
        if (model.endpoint && model.endpoint !== ":global") {
          const parts = model.endpoint.split(":");
          vertex_project = parts[0] || "";
          vertex_region = parts[1] || "global";
        }
      }
    }

    setEditingModelId(model.model_id);
    setForm({
      display_name: model.display_name,
      provider_type: model.provider_type,
      endpoint: model.endpoint,
      endpoint_custom: model.provider_type === "vertex" ? vertex_endpoint_mode === "custom" : model.endpoint !== DEFAULT_ENDPOINTS[model.provider_type],
      vertex_endpoint_mode,
      vertex_project,
      vertex_region,
      api_key: model.api_key,
      model_name: model.model_name,
      max_tokens: model.max_tokens,
      tags: model.tags,
    });
    setShowForm(true);
    setTestResult(null);
  };

  const handleDuplicate = async (model: CustomModel) => {
    try {
      setError(null);
      await customModelsApi.duplicateCustomModel(model.model_id);
      await loadModels();
      onModelsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate model");
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      setError(null);
      await customModelsApi.deleteCustomModel(modelId);
      await loadModels();
      onModelsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingModelId(null);
    setForm(emptyForm);
    setTestResult(null);
  };

  const handleAddNew = () => {
    setEditingModelId(null);
    setForm(emptyForm);
    setShowForm(true);
    setTestResult(null);
  };

  const headerRight = !showForm ? (
    <button className="btn-primary btn-sm" onClick={handleAddNew}>
      + {t("addModel")}
    </button>
  ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("manageModels")}
      titleRight={headerRight}
      className="modal-wide"
    >
      <div className="models-modal">
        {error && (
          <div className="models-error">
            {error}
            <button onClick={() => setError(null)} className="models-error-dismiss">
              ×
            </button>
          </div>
        )}

        {loading ? (
          <div className="models-loading">
            <div className="spinner"></div>
            <span>{t("loadingModels")}</span>
          </div>
        ) : showForm ? (
          // Add/Edit form
          <div className="model-form">
            <h3>{editingModelId ? t("editModel") : t("addModel")}</h3>

            {/* Provider Selection */}
            <div className="form-group">
              <label>{t("providerApiFormat")}</label>
              <div className="provider-buttons">
                {(
                  ["anthropic", "openai", "openai-responses", "gemini", "vertex"] as ProviderType[]
                ).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`provider-btn ${form.provider_type === p ? "selected" : ""}`}
                    onClick={() => handleProviderChange(p)}
                  >
                    {PROVIDER_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {/* Endpoint Selection */}
            <div className="form-group">
              <label>{t("endpoint")}</label>
              {form.provider_type === "vertex" ? (
                <>
                  <div className="endpoint-toggle">
                    <button
                      type="button"
                      className={`toggle-btn ${form.vertex_endpoint_mode === "project-region" ? "selected" : ""}`}
                      onClick={() => handleEndpointModeChange(false)}
                    >
                      Project / Region
                    </button>
                    <button
                      type="button"
                      className={`toggle-btn ${form.vertex_endpoint_mode === "custom" ? "selected" : ""}`}
                      onClick={() => handleEndpointModeChange(true)}
                    >
                      Custom
                    </button>
                  </div>
                  {form.vertex_endpoint_mode === "project-region" ? (
                    <div className="vertex-endpoint-inputs">
                      <div className="vertex-input-row">
                        <input
                          type="text"
                          value={form.vertex_project}
                          onChange={(e) => {
                            setForm((prev) => ({
                              ...prev,
                              vertex_project: e.target.value,
                              endpoint: `${e.target.value}:${prev.vertex_region}`,
                            }));
                          }}
                          placeholder="Project ID"
                          className="form-input"
                        />
                        <span className="separator">:</span>
                        <input
                          type="text"
                          value={form.vertex_region}
                          onChange={(e) => {
                            setForm((prev) => ({
                              ...prev,
                              vertex_region: e.target.value,
                              endpoint: `${prev.vertex_project}:${e.target.value}`,
                            }));
                          }}
                          placeholder="Region"
                          className="form-input"
                        />
                      </div>
                      <div className="endpoint-display mt-2 endpoint-truncate">
                        {form.vertex_endpoint_mode === "project-region"
                          ? constructVertexURL(form.vertex_project, form.vertex_region, form.model_name || "gemini-3-flash-preview")
                          : form.endpoint}
                      </div>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={form.endpoint}
                      onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                      placeholder="https://[location]-aiplatform.googleapis.com/v1/projects/[project]/locations/[location]/publishers/google/models/[model]:streamGenerateContent"
                      className="form-input"
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="endpoint-toggle">
                    <button
                      type="button"
                      className={`toggle-btn ${!form.endpoint_custom ? "selected" : ""}`}
                      onClick={() => handleEndpointModeChange(false)}
                    >
                      {t("defaultEndpoint")}
                    </button>
                    <button
                      type="button"
                      className={`toggle-btn ${form.endpoint_custom ? "selected" : ""}`}
                      onClick={() => handleEndpointModeChange(true)}
                    >
                      {t("customEndpoint")}
                    </button>
                  </div>
                  {form.endpoint_custom ? (
                    <input
                      type="text"
                      value={form.endpoint}
                      onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                      placeholder="https://..."
                      className="form-input"
                    />
                  ) : (
                    <div className="endpoint-display">{form.endpoint}</div>
                  )}
                </>
              )}
            </div>

            {/* Model Name with Presets */}
            <div className="form-group">
              <label>{t("model")}</label>
              <div className="model-presets">
                {DEFAULT_MODELS[form.provider_type].map((preset) => (
                  <button
                    key={preset.model_name}
                    type="button"
                    className={`preset-btn ${form.model_name === preset.model_name ? "selected" : ""}`}
                    onClick={() => handleSelectPresetModel(preset)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={form.model_name}
                onChange={(e) => setForm((prev) => ({ ...prev, model_name: e.target.value }))}
                placeholder="Model name (e.g., claude-sonnet-4-6)"
                className="form-input"
              />
            </div>

            {/* Display Name */}
            <div className="form-group">
              <label>{t("displayName")}</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
                placeholder={t("nameShownInSelector")}
                className="form-input"
              />
            </div>

            {/* API Key */}
            <div className="form-group">
              <label>
                {form.provider_type === "vertex" ? "Account Credentials (path)" : t("apiKey")}
              </label>
              <input
                type="text"
                value={form.api_key}
                onChange={(e) => setForm((prev) => ({ ...prev, api_key: e.target.value }))}
                placeholder={
                  form.provider_type === "vertex"
                    ? "/path/to/credentials.json"
                    : t("enterApiKey")
                }
                className="form-input"
                autoComplete="off"
              />
            </div>

            {/* Max Tokens */}
            <div className="form-group">
              <label>{t("maxContextTokens")}</label>
              <input
                type="number"
                value={form.max_tokens}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, max_tokens: parseInt(e.target.value) || 200000 }))
                }
                className="form-input"
              />
            </div>

            {/* Tags */}
            <div className="form-group">
              <label>
                {t("tags")}
                <span
                  className="info-icon-wrapper"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowTagsTooltip(!showTagsTooltip);
                  }}
                >
                  <span className="info-icon">
                    <svg
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </span>
                  {showTagsTooltip && <span className="info-tooltip">{t("tagsTooltip")}</span>}
                </span>
              </label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder={t("tagsPlaceholder")}
                className="form-input"
              />
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`test-result ${testResult.success ? "success" : "error"}`}>
                {testResult.success ? "✓" : "✗"} {testResult.message}
              </div>
            )}

            {/* Form Actions */}
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={handleCancel}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTest}
                disabled={testing || (!form.api_key && !editingModelId) || !form.model_name}
                title={
                  !form.model_name
                    ? "Enter model name to test"
                    : !form.api_key && !editingModelId
                      ? "Enter API key to test"
                      : ""
                }
              >
                {testing ? t("testingButton") : t("testButton")}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSave}
                disabled={!form.display_name || !form.api_key || !form.model_name}
              >
                {editingModelId ? t("save") : t("addModel")}
              </button>
            </div>
          </div>
        ) : (
          // Model List
          <>
            <div className="models-list">
              {/* Built-in models (from env vars or gateway) - read only */}
              {builtInModels
                .filter((m) => m.id !== "predictable")
                .map((model) => (
                  <div key={model.id} className="model-card model-card-builtin">
                    <div className="model-header">
                      <div className="model-info">
                        <span className="model-name">{model.display_name || model.id}</span>
                        <span className="model-source">{model.source}</span>
                      </div>
                    </div>
                    <div className="model-details">
                      <span className="model-api-name">{model.id}</span>
                    </div>
                  </div>
                ))}

              {/* Custom models - editable */}
              {models.map((model) => (
                <div key={model.model_id} className="model-card">
                  <div className="model-header">
                    <div className="model-info">
                      <span className="model-name">{model.display_name}</span>
                      <span className="model-provider">{PROVIDER_LABELS[model.provider_type]}</span>
                      {model.tags && (
                        <span className="model-badge" title={model.tags}>
                          {model.tags.split(",")[0]}
                        </span>
                      )}
                    </div>
                    <div className="model-actions">
                      <button
                        className="btn-icon"
                        onClick={() => handleDuplicate(model)}
                        title={t("duplicate")}
                      >
                        <svg
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => handleEdit(model)}
                        title={t("editModel")}
                      >
                        <svg
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                      <button
                        className="btn-icon btn-danger"
                        onClick={() => handleDelete(model.model_id)}
                        title={t("delete_")}
                      >
                        <svg
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="model-details">
                    <span className="model-api-name">{model.model_name}</span>
                    <span className="model-endpoint">{model.endpoint}</span>
                  </div>
                </div>
              ))}

              {/* Empty state when no models at all */}
              {builtInModels.length === 0 && models.length === 0 && (
                <div className="models-empty">
                  <p>{t("noModelsConfigured")}</p>
                  <p className="models-empty-hint">{t("noModelsHint")}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default ModelsModal;
