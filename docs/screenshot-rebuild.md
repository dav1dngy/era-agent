# Screenshot-to-website rebuild

Project Lab's **Rebuild** mode can start from one or more screenshots of a page you are authorized to
recreate. ERA hands the images to a coding agent *as images*, has it write a static website, and then
verifies the result by rendering it and comparing it with the screenshot. Status: v0.2.0 development.

## How it works

1. **Validate.** Each file is identified by its bytes (PNG, JPEG or WebP; never by name or extension),
   limited to 12 MB, 50 megapixels, at least 64 px per side, at most 6 files. SVG, GIF and anything else
   is refused (SVG can carry script).
2. **Strip metadata.** Copies without EXIF/XMP/IPTC/comment/text chunks are made under neutral names
   (`reference-1.png` …) inside the run folder. The original file name (which may be personal) and its
   location/camera metadata never reach an agent. The copies are re-checked: if stripping would damage an image, ERA refuses it.
3. **Hand to the agent as images.** Codex receives them through its native `--image` argument. Claude Code is
   given the folder and told to read the files with its file tool (**not validated against the real CLI**: the
   development machine's Claude Code was signed out). A `command` agent receives the paths as JSON in
   `ERA_REFERENCE_IMAGES` if it declares `capabilities.images: "env"`. An agent with `images: "none"` is
   refused before anything runs.
4. **Specification.** ERA writes `SPEC.md` (purpose, authorization, image facts, what will be checked, unknowns and
   assumptions, clean-room rules). REA is not used: a screenshot has no executable structure, and the report says so.
5. **Verify** (every attempt, up to `limits.maxAttempts`, with the score and hints fed back on failure):
   * `index.html` (configurable: `acceptance.visual.entry`) exists;
   * **offline**: no script, style, font, image or frame is loaded over the network, and the page is rendered with all
     network requests (and file reads outside the site) blocked;
   * **not a copy**: no file equals the screenshot by hash, no data URI embeds it, no project image is perceptually
     near-identical to it (≥ 0.97), and no single picture covers more than 70 % of the page;
   * **visual similarity** ≥ `acceptance.visual.threshold` (default **0.75**, configurable 0.5–0.99);
   * your own acceptance and test commands, if any.
6. **Review and approve.** Studio shows the screenshot and the rendering side by side with the score breakdown. Nothing is
   written to the destination until you approve; approval is bound to the verified diff as for every other run.

### The score

The rendered page and the screenshot are scaled to 96×96 and compared on four measures, combined as
`0.3·brightness + 0.2·color + 0.3·edges + 0.2·layout`: mean luminance difference, color-histogram overlap, correlation of
Sobel edge maps, and correlation of a 12×12 grid of regional brightness. It is a **heuristic**: it separates "same
layout and palette" from "different page" well, but it is not a pixel-exact or semantic comparison, and a low-detail screenshot makes any
page score higher. Calibration on real renders (fixtures in `tests/fixtures/screenshot`):

| Page compared with the reference | Score |
|---|---|
| identical | 1.00 |
| independent re-implementation of the same design (different markup and CSS) | 0.91 |
| a different page (dark login form) | 0.00 |
| blank page | 0.06 |

### The renderer and its sandbox

Rendering uses the Electron that ships with ERA Studio (`apps/studio`; the Studio app itself, or
`apps/studio/node_modules/electron`). It runs in a separate process under **ERA's macOS sandbox profile** (no network, writes
only to its output and a private temp directory, no reads of ERA's state), with its own in-memory session that cancels every
request except files inside the site folder and `data:`/`blob:` URLs. Chromium's *own* sandbox cannot be nested inside a
`sandbox-exec` profile (it aborts), so it is turned off **in that process only**; ERA's profile is what confines it. On a
platform without ERA's sandbox the renderer is refused unless you trust the project. If no renderer is installed, ERA says the
page was **not** compared and requires another acceptance check; it never reports a visual pass it did not measure.
`ERA_RENDERER_DISABLE=1` forces that path.

## Using it

Studio: **New Task → REBUILD → Reference → "Screenshot(s) of a page"**. In the desktop app pick files natively; in a browser
choose files (they are uploaded to a private folder, validated by content) or paste a path. Enter the destination folder and
why you are authorized, review the checklist, tick the authorization to send the images to the provider, start.

CLI:

```bash
era project create site --mode rebuild --reference ./landing.png --destination ./site \
    --task "Recreate this landing page as a static website" \
    --authorization "I designed this page" --team codex-only --allow-remote codex
era project check site          # prerequisites, all at once
era project rebuild site && era project show site
```

## What is sent where

The screenshot content leaves the machine if the agent is a remote provider (Codex, Claude Code). You authorize each provider per
project; the checklist and the consent dialog say so. Metadata is removed first. Anything *visible* in the screenshot (names, emails,
other windows) is visible to the provider: crop it first. Agents can read files elsewhere on your disk (see "Limits").

## Limits

* Only the first screenshot is scored; further ones are context for the implementer.
* Interactions, other viewports, animations and hidden states are not verified.
* The visual score is a heuristic. Fonts and photos are approximated by design (no external assets are allowed).
* A page that is a faithful *layout* but has wrong text can still score well: text is not compared. The implementer is told to
  reproduce the visible text; add an acceptance command (for example a script that greps the expected strings) when text matters.
* Provider CLIs are not sandboxed by ERA and can read files anywhere your user can. In the first validation run the agent
  **found the reference image on disk by the file name listed in the specification** and viewed it (see
  [provider-validation.md](provider-validation.md)). This does not affect correctness here (the image is meant to be seen), but it
  means a provider agent can also read other files in ERA's state directory.
