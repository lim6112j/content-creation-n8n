"use strict";

// ---------- Per-stage result review (film-review / film-asset webhooks) ----------

// UI stage id -> project.json `stages` key
const STAGE_KEY_MAP = Object.freeze({
  script: "script",
  shots: "images",
  animate: "videos",
  voice: "voiceover",
  assemble: "assembly",
});

const REVIEW_RENDERERS = Object.freeze({
  script: renderScriptReview,
  shots: renderShotsReview,
  animate: renderAnimateReview,
  voice: renderVoiceReview,
  assemble: renderFilmReview,
});

const reviewEls = {
  loadInput: document.getElementById("loadSlugInput"),
  loadBtn: document.getElementById("loadSlugBtn"),
  loadStatus: document.getElementById("loadStatus"),
};

function assetUrl(slug, filePath) {
  return CONFIG.ASSET_URL + "?slug=" + encodeURIComponent(slug) + "&file=" + encodeURIComponent(filePath);
}

async function fetchManifest(slug) {
  const response = await fetch(CONFIG.REVIEW_URL + "?slug=" + encodeURIComponent(slug));
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, "Review request failed with HTTP " + response.status + "."));
  }
  return payload;
}

async function refreshManifest(slug) {
  const manifest = await fetchManifest(slug);
  pipeline = { ...pipeline, manifest };
  renderPipeline();
}

// ---------- Load existing project by slug ----------

function setLoadStatus(message, isError) {
  if (!reviewEls.loadStatus) return;
  reviewEls.loadStatus.textContent = message;
  reviewEls.loadStatus.className = isError ? "hint load-status-err" : "hint";
}

async function loadPipelineBySlug() {
  const slug = reviewEls.loadInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) {
    setLoadStatus("Enter a project slug to load.", true);
    return;
  }

  reviewEls.loadBtn.disabled = true;
  reviewEls.loadBtn.textContent = "Loading…";
  setLoadStatus("Loading project…", false);

  try {
    const manifest = await fetchManifest(slug);
    if (manifest.status === "not_found") {
      setLoadStatus('No project found for slug "' + slug + '".', true);
      return;
    }
    setLoadStatus('Loaded "' + (manifest.title || slug) + '" — completed stages restored below.', false);
    initPipeline(slug, detectPipelineMode(manifest));
    pipeline = hydrateStagesFromManifest(manifest);
    renderPipeline();
    els.pipelineCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const hint = error instanceof TypeError
      ? "Could not reach " + CONFIG.REVIEW_URL + " — is the review workflow active? (" + error.message + ")"
      : error.message;
    setLoadStatus(hint, true);
  } finally {
    reviewEls.loadBtn.disabled = false;
    reviewEls.loadBtn.textContent = "Load";
  }
}

// A project that has run the Seedance stage is a Seedance project. Prefer the
// explicit provenance the Seedance assembly records, then the videos stage.
function detectPipelineMode(manifest) {
  const stages = manifest.stages || {};
  if (stages.assembly && stages.assembly.mode === "seedance") return "seedance";
  if (stages.videos) return "seedance";
  if (stages.voiceover) return "stills";
  return undefined; // let initPipeline fall back to the stored/default mode
}

function hydrateStagesFromManifest(manifest) {
  const stages = { ...pipeline.stages };
  for (const stage of PIPELINE_STAGES) {
    const stageInfo = (manifest.stages && manifest.stages[STAGE_KEY_MAP[stage.id]]) || {};
    if (stageInfo.status === "done") {
      stages[stage.id] = { status: "done", result: {}, error: "" };
    }
  }
  return { ...pipeline, stages, manifest };
}

function appendStageReview(body, stage) {
  if (!pipeline || !pipeline.manifest || pipeline.stages[stage.id].status !== "done") return;
  const renderer = REVIEW_RENDERERS[stage.id];
  if (!renderer) return;
  const review = document.createElement("div");
  review.className = "review";
  renderer(review, pipeline.manifest, pipeline.slug);
  if (review.childNodes.length) body.append(review);
}

// ---------- shared helpers ----------

function appendMuted(container, text) {
  const line = document.createElement("p");
  line.className = "review-muted";
  line.textContent = text;
  container.append(line);
}

function characterNameMap(manifest) {
  return Object.fromEntries((manifest.characters || []).map((c) => [c.id, c.name]));
}

function groupShotsByScene(shots) {
  const groups = [];
  for (const shot of shots) {
    const last = groups[groups.length - 1];
    if (last && last.sceneId === shot.scene_id) {
      last.shots = [...last.shots, shot];
    } else {
      groups.push({ sceneId: shot.scene_id, sceneTitle: shot.scene_title, shots: [shot] });
    }
  }
  return groups;
}

// ---------- script stage: characters + screenplay ----------

function renderScriptReview(container, manifest, slug) {
  const characters = manifest.characters || [];
  if (characters.length) {
    const list = document.createElement("div");
    list.className = "review-char-list";
    for (const character of characters) list.append(makeCharacterCard(character, slug));
    container.append(list);
  }

  const scenes = groupShotsByScene(manifest.shots || []);
  if (!scenes.length) {
    appendMuted(container, "No shots in the script yet.");
    return;
  }
  const names = characterNameMap(manifest);
  scenes.forEach((scene, index) => {
    container.append(makeSceneBlock(scene, index, names));
  });
}

function makeCharacterCard(character, slug) {
  const card = document.createElement("div");
  card.className = "review-char";

  if (character.has_anchor) {
    const img = document.createElement("img");
    img.src = assetUrl(slug, "refs/anchors/char_" + character.id + ".jpg");
    img.alt = character.name;
    img.loading = "lazy";
    card.append(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "char-placeholder";
    placeholder.textContent = "no anchor";
    card.append(placeholder);
  }

  const name = document.createElement("div");
  name.className = "cname";
  name.textContent = character.name;
  name.title = character.name;

  const voice = document.createElement("div");
  voice.className = "cvoice";
  voice.textContent = character.voice ? "voice: " + character.voice : "";

  const desc = document.createElement("div");
  desc.className = "cdesc";
  desc.textContent = character.visual_description;
  desc.title = character.visual_description;

  card.append(name, voice, desc);
  return card;
}

function makeSceneBlock(scene, index, names) {
  const details = document.createElement("details");
  details.className = "review-scene";
  details.open = index === 0;

  const summary = document.createElement("summary");
  const titleText = "Scene " + (index + 1) + (scene.sceneTitle ? " — " + scene.sceneTitle : "");
  summary.textContent = titleText + " ";
  const count = document.createElement("span");
  count.className = "shot-count";
  count.textContent = "(" + scene.shots.length + " shot" + (scene.shots.length === 1 ? "" : "s") + ")";
  summary.append(count);
  details.append(summary);

  for (const shot of scene.shots) details.append(makeShotCard(shot, names));
  return details;
}

function makeShotCard(shot, names) {
  const card = document.createElement("div");
  card.className = "review-shot-card";

  const header = document.createElement("div");
  header.className = "review-shot-id";
  const duration = Number(shot.duration_hint_sec);
  header.textContent = shot.id + (Number.isFinite(duration) && duration > 0 ? " · ~" + duration + "s" : "");
  card.append(header);

  const prompt = document.createElement("div");
  prompt.className = "review-shot-prompt";
  prompt.textContent = shot.image_prompt;
  prompt.title = shot.image_prompt;
  card.append(prompt);

  if (shot.narration) {
    const narration = document.createElement("div");
    narration.className = "review-shot-narration";
    narration.textContent = shot.narration;
    card.append(narration);
  }

  for (const line of shot.dialogue || []) {
    const speaker = (names && names[line.character]) || line.character;
    const dialogue = document.createElement("div");
    dialogue.className = "review-shot-dialogue";
    const speakerSpan = document.createElement("span");
    speakerSpan.className = "speaker";
    speakerSpan.textContent = speaker + ": ";
    dialogue.append(speakerSpan, document.createTextNode(line.text));
    card.append(dialogue);
  }
  return card;
}

// ---------- shots stage: image gallery ----------

function renderShotsReview(container, manifest, slug) {
  const allShots = manifest.shots || [];
  const withImage = allShots.filter((shot) => shot.has_image);
  if (!withImage.length) {
    appendMuted(container, "No shot images generated yet.");
    return;
  }

  const gallery = document.createElement("div");
  gallery.className = "review-gallery";
  for (const shot of withImage) gallery.append(makeShotFigure(shot, slug));
  container.append(gallery);

  const missing = allShots.length - withImage.length;
  if (missing > 0) appendMuted(container, missing + " shot(s) have no image yet — re-run the shots stage to fill gaps.");
}

function makeShotFigure(shot, slug) {
  const figure = document.createElement("figure");
  const link = document.createElement("a");
  link.href = assetUrl(slug, "shots/" + shot.id + ".png");
  link.target = "_blank";
  link.rel = "noopener";

  const img = document.createElement("img");
  img.src = link.href;
  img.alt = shot.id;
  img.loading = "lazy";
  img.width = 220;
  link.append(img);

  const caption = document.createElement("figcaption");
  caption.textContent = shot.id;

  figure.append(link, caption);
  return figure;
}

// ---------- animate stage: per-shot video players ----------

function renderAnimateReview(container, manifest, slug) {
  const shots = manifest.shots || [];
  if (!shots.length) {
    appendMuted(container, "No script shots found.");
    return;
  }

  const failed = new Set(
    ((manifest.stages && manifest.stages.videos && manifest.stages.videos.failed_ids) || []),
  );
  const list = document.createElement("div");
  list.className = "review-audio";
  let animated = 0;

  for (const shot of shots) {
    if (shot.has_video) {
      animated += 1;
      list.append(makeVideoRow(shot.id, slug));
    } else if (failed.has(shot.id)) {
      list.append(makeVideoNoteRow(shot.id, "generation failed — re-run Animate to retry"));
    } else {
      list.append(makeVideoNoteRow(shot.id, "no clip yet — run Animate, or assembly falls back to image motion"));
    }
  }
  container.append(list);
  if (!animated) appendMuted(container, "No animated clips yet.");
}

function makeVideoRow(shotId, slug) {
  const row = document.createElement("div");
  row.className = "review-audio-row";

  const label = document.createElement("span");
  label.className = "shot-label";
  label.textContent = shotId;

  const video = document.createElement("video");
  video.controls = true;
  video.preload = "none";
  video.src = assetUrl(slug, "videos/" + shotId + ".mp4");

  row.append(label, video);
  return row;
}

function makeVideoNoteRow(shotId, note) {
  const row = document.createElement("div");
  row.className = "review-audio-row";
  const label = document.createElement("span");
  label.className = "shot-label";
  label.textContent = shotId;
  const text = document.createElement("span");
  text.className = "review-silent";
  text.textContent = note;
  row.append(label, text);
  return row;
}

// ---------- voice stage: per-shot audio players ----------

function renderVoiceReview(container, manifest, slug) {
  const shots = manifest.shots || [];
  if (!shots.length) {
    appendMuted(container, "No script shots found.");
    return;
  }

  const silent = new Set(manifest.silent_shots || []);
  const durations = manifest.durations || {};
  const list = document.createElement("div");
  list.className = "review-audio";
  let audible = 0;

  for (const shot of shots) {
    if (silent.has(shot.id)) {
      list.append(makeAudioNoteRow(shot.id, "silent — no dialogue in this shot"));
    } else if (!shot.has_audio) {
      list.append(makeAudioNoteRow(shot.id, "audio missing — re-run the voice stage"));
    } else {
      audible += 1;
      list.append(makeAudioRow(shot.id, durations[shot.id], slug));
    }
  }
  container.append(list);
  if (!audible) appendMuted(container, "No spoken audio in this project.");
}

function makeAudioRow(shotId, durationSec, slug) {
  const row = document.createElement("div");
  row.className = "review-audio-row";

  const label = document.createElement("span");
  label.className = "shot-label";
  label.textContent = shotId;

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.src = assetUrl(slug, "audio/" + shotId + ".mp3");

  row.append(label, audio);

  const duration = Number(durationSec);
  if (durationSec != null && Number.isFinite(duration)) {
    const durationLabel = document.createElement("span");
    durationLabel.className = "duration";
    durationLabel.textContent = duration.toFixed(1) + "s";
    row.append(durationLabel);
  }
  return row;
}

function makeAudioNoteRow(shotId, note) {
  const row = document.createElement("div");
  row.className = "review-audio-row";
  const label = document.createElement("span");
  label.className = "shot-label";
  label.textContent = shotId;
  const text = document.createElement("span");
  text.className = "review-silent";
  text.textContent = note;
  row.append(label, text);
  return row;
}

// ---------- assemble stage: inline video player ----------

function renderFilmReview(container, manifest, slug) {
  if (!manifest.film || !manifest.film.exists) {
    appendMuted(container, "Film not yet assembled.");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "review-video";
  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.src = assetUrl(slug, "film.mp4");
  wrap.append(video);

  const meta = document.createElement("div");
  meta.className = "review-film-meta";
  meta.textContent = "film.mp4 · " + manifest.film.size_mb + " MB";
  wrap.append(meta);
  container.append(wrap);
}

// ---------- wiring ----------

reviewEls.loadBtn.addEventListener("click", loadPipelineBySlug);
reviewEls.loadInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadPipelineBySlug();
  }
});
