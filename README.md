# n8n Workflows

This project stores n8n workflow definitions and agent rules for local development against a Dockerized n8n server.

## Environment
- n8n URL: `http://localhost:5678`
- API base: `http://localhost:5678/api/v1`
- Workflow endpoint (this project): `POST /webhook/user-intention-fixer`

## User Intention Fixer (Hybrid)
Workflow name: `user intention fixer`

The workflow uses a hybrid architecture:
1. **Rules-first validation** checks if user intent is already clear.
2. If rules are uncertain, it routes to an **AI fallback**.
3. AI fallback uses **OpenRouter node with n8n credentials** (no raw API keys in code).
4. The workflow either:
   - returns `ready_for_processing`, or
   - returns `need_clarification` with a follow-up question.

## Current Node Flow
1. `Intention Input` (Webhook)
2. `Normalize Input` (Set)
3. `Rule Intention Gate` (Code)
4. `Rules say clear?` (IF)
   - **true** → `Proceed Next Node` → `Return Processing Payload`
   - **false** → `AI Clarifier Agent` (LangChain Agent)
     - model from `OpenRouter Model` (`@n8n/n8n-nodes-langchain.lmChatOpenRouter`)
     - parsed by `Parse AI Clarifier`
     - then `AI says clear?` (IF)
       - **true** → `Proceed Next Node` → `Return Processing Payload`
       - **false** → `Ask Clarification`

## Response Contract

### When clear
```json
{
  "status": "ready_for_processing",
  "intent": "<final intent>",
  "processing_payload": { "prompt": "<final intent>" }
}
```

### When unclear
```json
{
  "status": "need_clarification",
  "question": "<follow-up question>",
  "missing_fields": ["..."]
}
```

## Testing
Example production webhook test:

```bash
curl -sS -X POST "http://localhost:5678/webhook/user-intention-fixer" \
  -H "Content-Type: application/json" \
  --data '{"prompt":"Build an automation that ingests daily Shopify orders CSV from S3 and returns JSON summary by category"}'
```

## Film Project Setup UI

A static web form (`web/index.html`) for creating film projects via `film-01-project-setup.workflow.json`.

```bash
python3 -m http.server 8080 --directory web
# open http://localhost:8080/
```

Contract (enforced both client- and server-side):
- `film_title` — required
- `story` — required, at least 20 characters
- Reference images — 1–6 files, jpg/jpeg/png/webp, sent as form fields `image_1`…`image_6` (order = ref order)

Notes:
- **Refs feed character anchors, not shots directly.** The script stage (film-02) generates one canonical full-body anchor portrait per character (`refs/anchors/char_<id>.jpg`) from the uploaded refs plus the locked character sheet. Shot generation (film-03) then attaches only the anchors of characters present in each shot (max 3), with explicit `IMAGE N = <character>` mapping in the prompt. Scenery shots and shots with missing anchors fall back to the first 3 global refs. The form badges images 4+ as "unused in shots" — they are also unused for anchors.
- The script agent scales the shot budget to story length (~1 shot per 12 words, 6–48 shots), so longer stories produce longer films instead of crammed frames.
- The webhook nodes of all five film workflows have `allowedOrigins: "*"` so the page can POST cross-origin; n8n only sends CORS headers when the request carries an `Origin` header.
- Server-side validation failures return n8n's generic `{"message":"Error in workflow"}` — the precise messages ("Film Title is required.", etc.) come from the form's client-side validation.
- Requires the film workflows to be active in n8n.

### Pipeline buttons

After a project is created, the page shows a **Pipeline** card with the slug filled in automatically. A **Pipeline** selector at the top of the card picks between two modes, and the stage list below changes to match:

| Mode | Stages |
|------|--------|
| **Seedance** (default) | script → shots → animate → assemble |
| **No Seedance** | script → shots → voice → assemble (animate optional) |

The selection is remembered in `localStorage`; loading an existing project by slug auto-selects the mode that project has actually run.

**Seedance mode** animates every shot and assembles the resulting clips — there is no voiceover stage, because Seedance 2.0 Fast generates each clip's own audio. Stages:

1. **Generate script** → `POST /webhook/film-run-script` (`{project_slug}`) — shows `shotCount` and script path; also generates per-character anchor portraits
2. **Generate shot images** → `POST /webhook/film-gen-shots` — appears when the script finishes
3. **Animate shots (Seedance)** → `POST /webhook/film-gen-seedance` — real video clips with native audio
4. **Assemble final film** → `POST /webhook/film-assemble-seedance` — shows `filmPath`, duration, size, and a **⬇ Download film.mp4** button

**No Seedance mode** is the classic path — stills rendered with image motion, narrated by the TTS voiceover stage, assembled by `film-05`:

1. **Generate script** → `POST /webhook/film-run-script`
2. **Generate shot images** → `POST /webhook/film-gen-shots`
3. **Animate shots (Seedance)** → `POST /webhook/film-gen-seedance` (optional; assembly prefers these clips when present)
4. **Generate voiceover** → `POST /webhook/film-gen-voice` — appears when shots finish
5. **Assemble final film** → `POST /webhook/film-assemble`

Both assemble stages accept a **Subtitles** choice: *Burn into video* (default) or *Sidecar .srt only*. `subs.srt` is always written to the project folder either way — the choice only controls whether it is composited into `film.mp4`.

The download button hits `GET /webhook/film-download?slug=<slug>` (`film-download.workflow.json`), which streams the rendered `film.mp4` out of the n8n container as `video/mp4` with `Content-Disposition: attachment; filename="film.mp4"`. Only shown after assembly succeeds; requesting a slug with no rendered film returns an empty response (the UI never links to it in that state).

Each next button unlocks only when the previous stage completes; failed stages offer Retry. Shots/voiceover are idempotent (already-generated files are skipped unless `regen_ids` is passed — use curl for selective regeneration).

### In-browser stage review

After each stage completes, its actual output is rendered below the stage row (view-only):

1. **Script** — character cards with their generated anchor portraits (`refs/anchors/char_<id>.jpg`), voice, and visual description, plus a per-scene collapsible screenplay (shot id, image prompt, narration, dialogue with speaker names)
2. **Shots** — gallery of generated `shots/shot_XXX.png` stills (click for full size); missing images are noted
3. **Animate** — per-shot `videos/shot_XXX.mp4` players; failed generations are labeled from the stage's `failed_ids`
4. **Voiceover** (No Seedance mode only) — per-shot audio players for `audio/shot_XXX.mp3` with durations; silent shots are labeled instead of given a player
5. **Assemble** — inline `<video controls>` player of `film.mp4` with size, alongside the download button

These are served by `film-review.workflow.json` ("AI Film 07 — Review & Assets", workflow ID `ax3vTv5EOwKlT0Va`):

- `GET /webhook/film-review?slug=<slug>` — JSON manifest of the whole project (status, stage map, characters, scenes, shots with file-availability flags, durations, silent shots, film info). Returns `status: "not_found"` for unknown slugs.
- `GET /webhook/film-asset?slug=<slug>&file=<path>` — streams a project file inline (shots PNGs, anchor JPGs, audio MP3s, film.mp4, script.json). `file` must match a strict allowlist (e.g. `shots/shot_001.png`) — anything else is rejected.

### Load existing project by slug

The Pipeline card has a **Load existing project** input: enter a slug and completed stages are restored from the project's `project.json` stage map, with review sections rendered for each — so review survives a page reload. Unknown slugs show an error; nothing is overwritten on the server.

## Files
- `user-intention-fixer.workflow.json`: local source of truth for workflow definition.
- `film-0*.workflow.json`: AI film pipeline (setup → script + character anchors → shots → Seedance animation → voiceover → assemble).
- `film-05b-seedance-assemble.workflow.json`: Seedance-clip assembly (`POST /webhook/film-assemble-seedance`). Normalises each animated clip (keeping its native audio), concatenates in script order, and emits `film.mp4` + `subs.srt`. Distinct from `film-05`, which renders stills and mixes a TTS track.
- `film-download.workflow.json`: serves the rendered `film.mp4` for download (`GET /webhook/film-download?slug=...`, workflow ID `MewzwAdmqjhPoRAM`).
- `film-review.workflow.json`: stage-review manifest + asset proxy (`GET /webhook/film-review`, `GET /webhook/film-asset`, workflow ID `ax3vTv5EOwKlT0Va`).
- `web/index.html`: project setup web form (see "Film Project Setup UI").
- `web/config.js`: shared `CONFIG` and `PIPELINE_STAGES` definitions.
- `web/review.js`: manifest fetch, asset URL helper, per-stage review renderers, load-by-slug.
- `web/app.js`: form, thumbnails, and pipeline stage runner.
- `AGENT.md`: authoring rules and API workflow conventions.
