# A.Game — working notes

- Develop on the session's work branch, then **always fast-forward `main` to it and deploy to GitHub Pages** when a change is done (standing request from the owner). No need to ask first.
- Deploy: pushing `main` triggers `.github/workflows/deploy.yml`. If the `deploy` job is rejected instantly (no runner, no logs), the `github-pages` environment only allows the repo's default branch; run the workflow manually (`workflow_dispatch`) on the work branch at the same commit, and remind the owner to add `main` under Settings → Environments → github-pages.
- Before pushing: `npm run build` (typecheck + build) must pass; check behavior in headless Chromium (`?debug` exposes `window.game`).
- Concept rules (see README): no text, numbers or gauges in-game; monochrome only; triangle = attack, circle = health, square = outside the health system. World shapes are filled, control symbols are outlines.
- Write user-facing replies in Korean.
