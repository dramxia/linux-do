# Decisions - refactor-toolkit

## 2026-07-22 Plan-level decisions (from planning phase)
- TypeScript strict mode adopted (vetoable)
- esbuild as devDependency (zero runtime deps preserved)
- Shadow DOM for buttons/Toast only (base64 excluded)
- ContentScriptManager conditional (only if state residual bug found)
- layout.js split into 7 modules (not 5, due to 250 LOC constraint)
- Event bus one-directional (layout→buttons only)
- Vitest + hand-written chrome mock
- chrome110 esbuild target
- No Constructable Stylesheets (use <style> tag)
