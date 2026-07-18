# Screenshot and image guide

## Current status

No screenshots or images are included in the documentation at this time.

## Adding screenshots

When adding screenshots to documentation:

1. **Use a disposable test repository** — never use real project code, private repository names, or sensitive file paths.
2. **Use fake IDs** — replace Discord snowflakes (user IDs, channel IDs, message IDs) with placeholder values.
3. **Redact provider output** — ensure no API keys, credentials, access tokens, or device codes are visible.
4. **Use a clean theme** — screenshots should be legible in both light and dark Discord themes.
5. **Save in `docs/assets/`** — use descriptive filenames (e.g., `task-thread-overview.png`).
6. **Resize for readability** — screenshots should be wide enough to show context but not so large they require scrolling.

## Recommended layout

The root README.md is structured to support inserting a product screenshot or animated GIF between the "Core differentiators" list and the "Architecture" section without restructuring. The `docs/README.md` gateway page can also support a visual navigation aid.

## Image format

- Screenshots: PNG or JPEG
- Animated demonstrations: GIF or MP4 (via `<video>` tag in GitHub Markdown)
- Diagrams: SVG or Mermaid (for Markdown-native diagrams)

## Verification

Before committing images:
- Confirm no sensitive information is visible in the image.
- Confirm images render correctly on GitHub (test by viewing on a branch).
- Keep file sizes reasonable (< 1 MB per image).
