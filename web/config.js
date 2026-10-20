"use strict";

const CONFIG = Object.freeze({
  WEBHOOK_URL: "http://localhost:5678/webhook/film-project-setup",
  DOWNLOAD_URL: "http://localhost:5678/webhook/film-download",
  REVIEW_URL: "http://localhost:5678/webhook/film-review",
  ASSET_URL: "http://localhost:5678/webhook/film-asset",
  MAX_REFS: 6,
  REFS_USED_IN_SHOTS: 3,
  MIN_STORY_CHARS: 20,
  ALLOWED_EXTENSIONS: ["jpg", "jpeg", "png", "webp"],
});

// ---------- Stage definitions ----------
// Pipeline modes below each run a different stage list: "seedance" animates
// every shot and assembles the clips (their own audio replaces the voiceover
// stage); "stills" is the classic stills + TTS pipeline.
const STAGE_STILLS = Object.freeze([
  {
    id: "script",
    label: "Generate script",
    endpoint: "http://localhost:5678/webhook/film-run-script",
    detail: "The script agent writes the screenplay from your story (usually under a minute).",
    resultFields: Object.freeze([["shotCount", "Shots"], ["slug", "Slug"], ["scriptPath", "Path"]]),
    requires: Object.freeze([]),
  },
  {
    id: "shots",
    label: "Generate shot images",
    endpoint: "http://localhost:5678/webhook/film-gen-shots",
    detail: "One image per shot via OpenRouter — can take several minutes. Safe to re-run: existing shots are skipped.",
    resultFields: Object.freeze([["shotsPath", "Path"], ["nextStep", "Next"]]),
    requires: Object.freeze(["script"]),
  },
  {
    id: "animate",
    label: "Animate shots (Seedance)",
    endpoint: "http://localhost:5678/webhook/film-gen-seedance",
    detail: "Seedance 2.0 Fast turns each shot image into a real video clip with its own generated audio. Costs per clip and can take many minutes. Safe to re-run: existing clips are skipped.",
    resultFields: Object.freeze([["animatedCount", "Animated"], ["skippedCount", "Skipped"], ["failedIds", "Failed"], ["videosPath", "Path"]]),
    requires: Object.freeze(["shots"]),
  },
  {
    id: "voice",
    label: "Generate voiceover",
    endpoint: "http://localhost:5678/webhook/film-gen-voice",
    detail: "Text-to-speech per line, mixed into per-shot audio tracks. Safe to re-run.",
    resultFields: Object.freeze([["audioPath", "Path"], ["nextStep", "Next"]]),
    requires: Object.freeze(["shots"]),
  },
  {
    id: "assemble",
    label: "Assemble final film",
    endpoint: "http://localhost:5678/webhook/film-assemble",
    detail: "FFmpeg renders each shot (image motion), mixes the voiceover audio and subtitles, and concatenates the final film — can take several minutes.",
    resultFields: Object.freeze([["filmPath", "Film"], ["durationSeconds", "Duration (s)"], ["sizeMb", "Size (MB)"], ["nextStep", "Next"]]),
    requires: Object.freeze(["voice"]),
    download: true,
    subtitles: true,
  },
]);

// Seedance mode: the animated clips carry their own audio, so the voiceover
// stage is dropped and assembly reads its timeline from the clips.
const STAGE_SEEDANCE = Object.freeze([
  STAGE_STILLS[0], // script
  STAGE_STILLS[1], // shots
  STAGE_STILLS[2], // animate
  {
    id: "assemble",
    label: "Assemble final film",
    endpoint: "http://localhost:5678/webhook/film-assemble-seedance",
    detail: "FFmpeg normalises each Seedance clip (keeping its native audio), concatenates them in script order, and emits film.mp4 plus subs.srt — can take several minutes.",
    resultFields: Object.freeze([["filmPath", "Film"], ["durationSeconds", "Duration (s)"], ["sizeMb", "Size (MB)"], ["nextStep", "Next"]]),
    requires: Object.freeze(["animate"]),
    download: true,
    subtitles: true,
  },
]);

// Subtitle handling for the assemble stage. The .srt is always written to the
// project folder; this chooses whether it is also burned into the video.
const SUBTITLE_OPTIONS = Object.freeze([
  Object.freeze({ value: "burn", label: "Burn into video" }),
  Object.freeze({ value: "srt", label: "Sidecar .srt only" }),
]);

const PIPELINE_MODES = Object.freeze({
  seedance: Object.freeze({
    id: "seedance",
    label: "Seedance",
    hint: "Animated clips with their own generated audio — no voiceover stage.",
    stages: STAGE_SEEDANCE,
  }),
  stills: Object.freeze({
    id: "stills",
    label: "No Seedance",
    hint: "Stills with image motion, narrated by the text-to-speech voiceover stage.",
    stages: STAGE_STILLS,
  }),
});

const DEFAULT_PIPELINE_MODE = "seedance";

// Reassigned by setPipelineMode() in app.js. Kept as a mutable binding so the
// existing PIPELINE_STAGES loops in app.js and review.js keep working.
let PIPELINE_STAGES = PIPELINE_MODES[DEFAULT_PIPELINE_MODE].stages;
