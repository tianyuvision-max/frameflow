# SVGA Web Player

- Upstream: [svga/SVGAPlayer-Web-Lite](https://github.com/svga/SVGAPlayer-Web-Lite)
- Vendored release: `svga@2.1.1`, browser UMD bundle `dist/index.min.js`
- The package tarball declares MIT in `package.json`, while its included `LICENSE` file contains Apache-2.0. Keep the upstream license file beside the unmodified bundle; review this upstream metadata mismatch before changing or upgrading the dependency.
- The bundle is self-hosted and loaded from `libs/svga/svga.min.js`; do not replace it with a CDN URL.

The integration currently uses the package's runtime `Player.drawFrame` method for deterministic still-frame extraction. The method is marked private in the TypeScript declarations, so the bundled release is pinned and guarded at runtime.
