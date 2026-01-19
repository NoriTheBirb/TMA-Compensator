# Deploy to GitHub Pages

This Angular app is deployable as a static site.

## What’s configured

- Path-based routing is used (URLs look like `/report`).
- `ng/public/404.html` implements a GitHub Pages SPA redirect so refresh / deep links work on Pages.
- A GitHub Actions workflow builds and deploys the production build to GitHub Pages.

## One-time GitHub settings

1. In your GitHub repo, open **Settings → Pages**.
2. Under **Build and deployment**, choose **Source: GitHub Actions**.

## Deploy

- Push to the `main` branch.
- The workflow `.github/workflows/deploy-pages.yml` will:
  - run `npm ci` in `ng/`
  - build with `--base-href /<repo>/`
  - deploy `ng/dist/tma-compensator-ng` to Pages

## Local preview

- Development: `cd ng` then `npm.cmd start`
- Production build: `cd ng` then `npm.cmd run build`
  - output: `ng/dist/tma-compensator-ng`

## Notes

- If you rename the GitHub repo, the workflow automatically picks up the new repo name for `--base-href`.
- If you ever disable the 404 redirect, deep links like `/<repo>/report` will 404 on GitHub Pages.
