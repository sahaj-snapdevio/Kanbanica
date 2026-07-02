# Asset attributions & licensing

A record of the static assets shipped in `public/` and their provenance, so the
project can be redistributed under the MIT license with confidence.

| Asset | Type | Provenance / License |
|-------|------|----------------------|
| `Kanbanica2.png`, `Kanbanica3.png` | Logo / brand mark | Original project brand assets — part of this repository (MIT). |
| `icon-16.png`, `icon-32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Favicons / PWA icons | Original, generated from the project logo (MIT). |
| `after2.webp`, `before2.webp` | Product UI screenshots | Original screenshots of the app showing **fictional demo data** (no real user data). Part of this repository (MIT). |
| `log-illus.webp` | Login illustration | ⚠️ **Verify before publishing:** confirm this illustration is original or covered by a redistribution-friendly license. If it came from a stock/illustration library, replace it or record the license here. |
| `sw.js` | Service worker | Original source (MIT). |

## External images (not bundled)

The marketing landing page (`components/landing-page.tsx`) uses a few avatar
photos loaded directly from **Unsplash** (`images.unsplash.com`). These are
served from Unsplash's CDN under the [Unsplash License](https://unsplash.com/license)
(free for commercial use, no attribution required) and are **not** redistributed
in this repository. Self-hosters may replace them with their own imagery.

## Notes for maintainers

- Keep bundled raster assets optimized (screenshots/illustrations are stored as
  WebP). Regenerate at high quality (q≈90) if you replace them.
- Before the first public release, resolve the ⚠️ item above.
