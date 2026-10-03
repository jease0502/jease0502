# Profile automation

This repository powers the dynamic sections on the `@jease0502` GitHub profile.

## Generated assets

- `assets/private-contribution-wall.svg` — authenticated 365-day contribution calendar.
- `assets/private-snake.svg` — animated contribution visualization based on the same calendar.
- `assets/github-signal.svg` — authenticated activity and language summary.
- `assets/hero.svg` and `assets/robotics-loop.svg` — static-in-repo animated SVG presentation assets.

## Privacy model

The private-aware metrics are generated inside GitHub Actions using the `PROFILE_PAT` repository secret. The token is never written into generated SVG files or committed to the repository.

Private repository names and source code are not rendered into the public profile assets. Only aggregate metrics and language totals are displayed.

## Refresh schedule

The workflow in `.github/workflows/contribution-wall.yml` refreshes the generated metrics daily and when the generator/workflow itself changes.

## Maintenance

If the PAT expires or is rotated, replace the `PROFILE_PAT` Actions secret and rerun the workflow.
