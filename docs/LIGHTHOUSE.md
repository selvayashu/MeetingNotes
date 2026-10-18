# Lighthouse / PWA installability checklist

> **Note:** Lighthouse 12 (Chrome 126+) removed the separate "PWA" category. Installability is now
> checked in **Chrome DevTools → Application → Manifest** (the *Installability* section) and by the
> browser's own install prompt. The checks below cover what the old Lighthouse PWA audit tested,
> plus iOS. Run them against the **production build** (`npm run build && npm run preview`, or the
> deployed HTTPS site); the service worker is disabled in `npm run dev`.

## Installability

| Check | How MeetNotes meets it | Where |
|---|---|---|
| Served over HTTPS (or localhost) | Netlify / Cloudflare Pages HTTPS. `localhost` for preview | hosting |
| Web app manifest is linked | `<link rel="manifest" href="/manifest.json">` injected at build | `vite.config.ts` |
| `name` and `short_name` | "MeetNotes – AI Meeting Notes" / "MeetNotes" | manifest |
| `start_url` and `scope` | `/` and `/` | manifest |
| `display` is standalone | `standalone` | manifest |
| 192 px and 512 px icons | `icons/icon-192.png`, `icons/icon-512.png` | `public/icons` |
| Maskable icon | `icons/maskable-192.png`, `icons/maskable-512.png` (`purpose: maskable`, glyph in the 80% safe zone) | `public/icons` |
| `theme_color` and `<meta name="theme-color">` | `#4f46e5` (switched to dark at runtime in dark mode) | manifest, `index.html` |
| `background_color` (splash screen) | `#ffffff` | manifest |
| Registers a service worker with a fetch handler | Workbox precache + navigation route | `src/sw.ts` |
| Works offline / start URL responds offline | App shell precached. Navigations fall back to cached `index.html` | `src/sw.ts` |
| Apple touch icon (iOS) | `icons/apple-touch-icon.png` (180 px) | `index.html` |
| iOS standalone meta | `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` | `index.html` |
| Viewport meta, content sized to viewport | `width=device-width, initial-scale=1, viewport-fit=cover`, no horizontal scroll | `index.html`, CSS |
| Custom install UX | `beforeinstallprompt` captured → *Install* button; iOS gets "Share → Add to Home Screen" | `InstallBanner.tsx` |

## How to verify

1. `cd frontend && npm run build && npm run preview`, then open `http://localhost:4173` in Chrome.
2. **DevTools → Application → Manifest:** no errors or warnings under *Installability*. The icons
   (including maskable, via "Show only the minimum safe area") render correctly.
3. **Application → Service workers:** `sw.js` is *activated and running*.
4. Tick **Offline** in DevTools → Network and reload. The app still loads and you can navigate between Home, Meetings and Settings.
5. The install icon appears in the address bar, or the in-app **Install** banner works. After installing, the app opens in its own window.
6. **Lighthouse** (DevTools → Lighthouse → Mobile → Performance, Accessibility, Best practices, SEO): aim for
   90+ in each. If you use Lighthouse 11 or older (e.g. `npx lighthouse@11 http://localhost:4173 --only-categories=pwa`),
   the PWA category should show *Installable* and *PWA Optimized* as passing.
7. **Android:** open the HTTPS site in Chrome and choose *Install app*. The icon must not be cropped (maskable).
8. **iOS (Safari 16.4+):** Share → *Add to Home Screen*. It opens full-screen with the correct icon and title.
9. **Desktop (Chrome/Edge):** use the install icon in the address bar.
10. **Offline queue test:** in the installed app, go offline, record 20 s, and stop. The meeting shows *Waiting*.
    Go back online. Within a few seconds (or on the next app open) it is transcribed and summarised.

## Results log

Record your results after each release:

| Date | Build | Installable (Chrome) | Offline start | PWA (LH 11) | Accessibility | Best practices | Notes |
|---|---|---|---|---|---|---|---|
| 2026-10-18 | 1.0.0, `vite preview`, Lighthouse 11.7.1 mobile, headless Chrome | ☑ installable-manifest, maskable-icon, splash-screen, themed-omnibox, viewport, content-width all pass | ☐ manual check pending | 100 | 100 | 100 | Device install tests (Android/iOS/desktop) still to be done on the deployed HTTPS site |
