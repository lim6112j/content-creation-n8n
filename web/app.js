"use strict";

const els = {
  form: document.getElementById("filmForm"),
  title: document.getElementById("filmTitle"),
  story: document.getElementById("story"),
  counter: document.getElementById("storyCounter"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  thumbs: document.getElementById("thumbs"),
  submitBtn: document.getElementById("submitBtn"),
  errorPanel: document.getElementById("errorPanel"),
  errorText: document.getElementById("errorText"),
  resultPanel: document.getElementById("resultPanel"),
  resSlug: document.getElementById("resSlug"),
  resRefs: document.getElementById("resRefs"),
  resPath: document.getElementById("resPath"),
  resNext: document.getElementById("resNext"),
  pipelineCard: document.getElementById("pipelineCard"),
  pipelineSlug: document.getElementById("pipelineSlug"),
  pipelineSteps: document.getElementById("pipelineSteps"),
  modeSelect: document.getElementById("modeSelect"),
  modeHint: document.getElementById("modeHint"),
  subtitleGroup: document.getElementById("subtitleGroup"),
  subtitleSelect: document.getElementById("subtitleSelect"),
};

let images = []; // [{ id, file, url }]
let nextImageId = 1;
let pipeline = null; // { slug, manifest, mode, subtitles, stages: { [id]: { status, result, error } } }
let elapsedTimer = null; // { stageId, interval }

function getExtension(filename) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

// Optional per-image character name: "@main-character" → "main_character".
// Underscore form so it matches the character ids the script agent will use.
function sanitizeRefName(raw) {
  return (raw ?? "")
    .toString()
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function addFiles(fileList) {
  const incoming = Array.from(fileList);
  const accepted = [];
  for (const file of incoming) {
    if (!CONFIG.ALLOWED_EXTENSIONS.includes(getExtension(file.name))) continue;
    if (images.length + accepted.length >= CONFIG.MAX_REFS) break;
    accepted.push({ id: nextImageId++, file, url: URL.createObjectURL(file), name: "" });
  }
  images = [...images, ...accepted];
  renderThumbs();
}

function removeImage(id) {
  const target = images.find((img) => img.id === id);
  if (target) URL.revokeObjectURL(target.url);
  images = images.filter((img) => img.id !== id);
  renderThumbs();
}

function makeBadgeText(index, name) {
  if (name) return "@" + name;
  return index < CONFIG.REFS_USED_IN_SHOTS
    ? "ref_" + String(index + 1).padStart(2, "0")
    : "unused in shots";
}

function setRefName(id, raw, badge, index) {
  const name = sanitizeRefName(raw);
  images = images.map((img) => (img.id === id ? { ...img, name } : img));
  badge.textContent = makeBadgeText(index, name);
}

function moveImage(id, offset) {
  const index = images.findIndex((img) => img.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= images.length) return;
  const reordered = [...images];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);
  images = reordered;
  renderThumbs();
}

function renderThumbs() {
  els.thumbs.replaceChildren();
  images.forEach((img, index) => {
    const card = document.createElement("div");
    card.className = "thumb";

    const preview = document.createElement("img");
    preview.src = img.url;
    preview.alt = img.file.name;

    const badge = document.createElement("div");
    badge.className = "badge" + (index < CONFIG.REFS_USED_IN_SHOTS ? "" : " unused");
    badge.textContent = makeBadgeText(index, img.name);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "ref-name";
    nameInput.placeholder = "name, e.g. main_character";
    nameInput.value = img.name;
    nameInput.title = "Optional character name. Mention @" + (img.name || "name") + " in the story to bind this image to that character.";
    nameInput.addEventListener("input", () => setRefName(img.id, nameInput.value, badge, index));

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = img.file.name;
    name.title = img.file.name;

    const tools = document.createElement("div");
    tools.className = "tools";
    tools.append(
      makeToolButton("↑", "Move up", () => moveImage(img.id, -1)),
      makeToolButton("↓", "Move down", () => moveImage(img.id, 1)),
      makeToolButton("✕", "Remove", () => removeImage(img.id)),
    );

    card.append(preview, badge, tools, nameInput, name);
    els.thumbs.append(card);
  });
}

function makeToolButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function updateStoryCounter() {
  const length = els.story.value.trim().length;
  els.counter.textContent = length + " / " + CONFIG.MIN_STORY_CHARS + " min";
  els.counter.className = "counter " + (length >= CONFIG.MIN_STORY_CHARS ? "ok" : "short");
}

function validate() {
  const errors = [];
  if (!els.title.value.trim()) errors.push("Film title is required.");
  if (els.story.value.trim().length < CONFIG.MIN_STORY_CHARS) {
    errors.push("Story is required (at least " + CONFIG.MIN_STORY_CHARS + " characters).");
  }
  if (!images.length) errors.push("Please add at least 1 reference image.");
  if (images.length > CONFIG.MAX_REFS) errors.push("Please add at most " + CONFIG.MAX_REFS + " reference images.");
  const names = images.map((img) => img.name).filter(Boolean);
  const dupes = names.filter((name, i) => names.indexOf(name) !== i);
  if (dupes.length) errors.push("Each image name must be unique. Duplicate: " + [...new Set(dupes)].join(", ") + ".");
  return errors;
}

function buildFormData() {
  const data = new FormData();
  data.append("film_title", els.title.value.trim());
  data.append("story", els.story.value.trim());
  images.forEach((img, index) => {
    data.append("image_" + (index + 1), img.file, img.file.name);
    data.append("image_name_" + (index + 1), img.name);
  });
  return data;
}

function showError(message) {
  els.errorText.textContent = message;
  els.errorPanel.classList.remove("hidden");
  els.resultPanel.classList.add("hidden");
}

function showResult(data) {
  els.resSlug.textContent = data.slug ?? "—";
  els.resRefs.textContent = String(data.refCount ?? "—") + " reference image(s)";
  els.resPath.textContent = data.projectPath ?? "—";
  els.resNext.textContent = data.nextStep ?? "—";
  els.resultPanel.classList.remove("hidden");
  els.errorPanel.classList.add("hidden");
  if (data.slug) initPipeline(data.slug);
}

function extractErrorMessage(payload, fallback) {
  if (payload && typeof payload.message === "string" && payload.message) return payload.message;
  return fallback;
}

// ---------- Pipeline stages ----------

const MODE_STORAGE_KEY = "aiFilmPipelineMode";
const SUBTITLE_STORAGE_KEY = "aiFilmSubtitles";

function readStoredMode() {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    return PIPELINE_MODES[stored] ? stored : DEFAULT_PIPELINE_MODE;
  } catch (error) {
    return DEFAULT_PIPELINE_MODE;
  }
}

function readStoredSubtitles() {
  try {
    const stored = localStorage.getItem(SUBTITLE_STORAGE_KEY);
    return SUBTITLE_OPTIONS.some((option) => option.value === stored) ? stored : "burn";
  } catch (error) {
    return "burn";
  }
}

function storePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Storage can be unavailable (private mode); the in-memory state still applies.
  }
}

// Reassigns the PIPELINE_STAGES binding the rest of the file iterates over.
function applyPipelineMode(mode) {
  PIPELINE_STAGES = (PIPELINE_MODES[mode] ?? PIPELINE_MODES[DEFAULT_PIPELINE_MODE]).stages;
}

function setPipelineMode(mode, options = {}) {
  const next = PIPELINE_MODES[mode] ? mode : DEFAULT_PIPELINE_MODE;
  applyPipelineMode(next);
  storePreference(MODE_STORAGE_KEY, next);
  if (!options.silent) els.modeSelect.value = next;
  els.modeHint.textContent = PIPELINE_MODES[next].hint;

  if (pipeline) {
    pipeline = { ...pipeline, mode: next, stages: buildInitialStages() };
    renderPipeline();
  }
}

function setSubtitles(value) {
  const next = SUBTITLE_OPTIONS.some((option) => option.value === value) ? value : "burn";
  storePreference(SUBTITLE_STORAGE_KEY, next);
  if (pipeline) pipeline = { ...pipeline, subtitles: next };
  els.subtitleSelect.value = next;
}

function populateModeControls() {
  els.modeSelect.replaceChildren();
  for (const mode of Object.values(PIPELINE_MODES)) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.label;
    els.modeSelect.append(option);
  }
  els.subtitleSelect.replaceChildren();
  for (const choice of SUBTITLE_OPTIONS) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    els.subtitleSelect.append(option);
  }
  els.modeSelect.addEventListener("change", () => setPipelineMode(els.modeSelect.value));
  els.subtitleSelect.addEventListener("change", () => setSubtitles(els.subtitleSelect.value));
}

function buildInitialStages() {
  return Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage.id, { status: "pending", result: null, error: "" }]),
  );
}

function initPipeline(slug, mode) {
  stopElapsedTimer();
  const selected = PIPELINE_MODES[mode] ? mode : readStoredMode();
  applyPipelineMode(selected);
  els.modeSelect.value = selected;
  els.modeHint.textContent = PIPELINE_MODES[selected].hint;
  pipeline = {
    slug,
    mode: selected,
    subtitles: readStoredSubtitles(),
    stages: buildInitialStages(),
    manifest: null,
  };
  els.subtitleSelect.value = pipeline.subtitles;
  els.pipelineCard.classList.remove("hidden");
  renderPipeline();
}

function isStageUnlocked(stage) {
  return (stage.requires ?? []).every((id) => pipeline.stages[id] && pipeline.stages[id].status === "done");
}

function updateStage(stageId, patch) {
  if (!pipeline) return;
  const current = pipeline.stages[stageId];
  pipeline = { ...pipeline, stages: { ...pipeline.stages, [stageId]: { ...current, ...patch } } };
  renderPipeline();
}

function startElapsed(stageId) {
  stopElapsedTimer();
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const span = document.getElementById("elapsed-" + stageId);
    if (span) span.textContent = Math.round((Date.now() - startedAt) / 1000) + "s elapsed";
  }, 1000);
  elapsedTimer = { stageId, interval };
}

function stopElapsedTimer() {
  if (!elapsedTimer) return;
  clearInterval(elapsedTimer.interval);
  elapsedTimer = null;
}

// Only the assemble stage takes extra body fields; everything else sends the
// slug alone, as before.
function buildStageBody(stage) {
  const body = { project_slug: pipeline.slug };
  if (stage.subtitles) {
    body.burn_subs = pipeline.subtitles === "burn";
  }
  return body;
}

async function runStage(stageId) {
  if (!pipeline) return;
  const stage = PIPELINE_STAGES.find((s) => s.id === stageId);
  if (!stage) return;

  updateStage(stageId, { status: "running", error: "" });
  startElapsed(stageId);

  try {
    const response = await fetch(stage.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildStageBody(stage)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, "Request failed with HTTP " + response.status + "."));
    }
    updateStage(stageId, { status: "done", result: payload ?? {} });
    try {
      await refreshManifest(pipeline.slug); // pull the new stage output into the review sections
    } catch (manifestError) {
      console.warn("Manifest refresh failed:", manifestError);
    }
  } catch (error) {
    const hint = error instanceof TypeError
      ? "Could not reach " + stage.endpoint + " — is the workflow active and CORS-enabled? (" + error.message + ")"
      : error.message;
    updateStage(stageId, { status: "failed", error: hint });
  } finally {
    stopElapsedTimer();
  }
}

const STAGE_ICONS = Object.freeze({ pending: "○", done: "✓", failed: "✗" });

function renderPipeline() {
  if (!pipeline) return;
  els.pipelineSlug.textContent = pipeline.slug;
  els.pipelineSteps.replaceChildren();
  PIPELINE_STAGES.forEach((stage, index) => {
    els.pipelineSteps.append(makeStageRow(stage, index, pipeline.stages[stage.id]));
  });
}

function makeStageRow(stage, index, state) {
  const row = document.createElement("div");
  row.className = "stage";

  row.append(makeStageIcon(state), makeStageBody(stage, state));

  const button = makeStageButton(stage, state);
  if (button) row.append(button);
  return row;
}

function makeStageIcon(state) {
  const icon = document.createElement("div");
  icon.className = "icon " + state.status;
  if (state.status === "running") {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    icon.append(spinner);
  } else {
    icon.textContent = STAGE_ICONS[state.status] ?? "○";
  }
  return icon;
}

function makeStageBody(stage, state) {
  const body = document.createElement("div");
  body.className = "body";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = stage.label;
  body.append(label);

  if (state.status === "running") {
    const elapsed = document.createElement("span");
    elapsed.className = "elapsed";
    elapsed.id = "elapsed-" + stage.id;
    elapsed.textContent = "0s elapsed";
    label.append(" ", elapsed);
  }

  const detail = document.createElement("div");
  detail.className = "detail";
  detail.textContent = stage.detail;
  body.append(detail);

  if (state.status === "failed" && state.error) {
    const errorLine = document.createElement("div");
    errorLine.className = "stage-error";
    errorLine.textContent = state.error;
    body.append(errorLine);
  }
  if (state.status === "done" && state.result) {
    body.append(makeStageResult(state.result, stage));
    if (stage.download && pipeline) body.append(makeDownloadLink(pipeline.slug));
  }
  appendStageReview(body, stage);
  return body;
}

function makeDownloadLink(slug) {
  const link = document.createElement("a");
  link.className = "download-btn";
  link.href = CONFIG.DOWNLOAD_URL + "?slug=" + encodeURIComponent(slug);
  link.textContent = "⬇ Download film.mp4";
  return link;
}

function makeStageButton(stage, state) {
  if (state.status === "running") {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.textContent = "Running…";
    return button;
  }
  if (state.status === "done") return null;
  if (state.status === "pending" && !isStageUnlocked(stage)) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = state.status === "failed" ? "Retry" : stage.label;
  button.addEventListener("click", () => runStage(stage.id));
  return button;
}

function makeStageResult(result, stage) {
  const dl = document.createElement("dl");
  dl.className = "kv";
  for (const [field, label] of stage.resultFields) {
    if (result[field] === undefined || result[field] === null) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(result[field]);
    dl.append(dt, dd);
  }
  return dl;
}

async function submitForm(event) {
  event.preventDefault();

  const errors = validate();
  if (errors.length) {
    showError(errors.join(" "));
    return;
  }

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = "Creating project… (FFmpeg normalization takes a moment)";
  els.errorPanel.classList.add("hidden");

  try {
    const response = await fetch(CONFIG.WEBHOOK_URL, { method: "POST", body: buildFormData() });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, "Request failed with HTTP " + response.status + "."));
    }
    showResult(payload ?? {});
  } catch (error) {
    const hint = error instanceof TypeError
      ? "Could not reach the webhook — is n8n running, active, and CORS-enabled? (" + error.message + ")"
      : error.message;
    showError(hint);
  } finally {
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = "Create film project";
  }
}

function setupDropzone() {
  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = "";
  });
  for (const eventName of ["dragenter", "dragover"]) {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  }
  els.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
}

setupDropzone();
els.story.addEventListener("input", updateStoryCounter);
els.form.addEventListener("submit", submitForm);

// Build the mode/subtitle controls and apply the stored preference before the
// first pipeline render, so PIPELINE_STAGES matches what the selector shows.
populateModeControls();
setPipelineMode(readStoredMode(), { silent: false });
setSubtitles(readStoredSubtitles());
updateStoryCounter();
