# Fruity Jibesh 🍉

<img
  src="static/opengraph.png"
  alt="Fruity Jibesh with a pile of fruit"
  width="600"
/>

A browser-based fruit-merging puzzle game inspired by [Suika Game](https://www.nintendo.com/us/store/products/suika-game-switch/). Drop fruits into a container — when two identical fruits touch, they merge into the next fruit in the evolution chain. Combine your way up through **11 fruits** (blueberry → grape → lemon → orange → apple → dragonfruit → pear → peach → pineapple → honeydew → watermelon) and chase the highest score.

This repository is a feature-enhanced fork of [Subak Game](https://github.com/Fauntleroy/subak-game). It builds on Subak's fruit-merging gameplay with fruit and preset customization, local save/load, and shareable preset files.

The original game, "Merge Big Watermelon" (合成大西瓜), was created by Meadow Science (米兜科技). This project was built as a fun memento of a team off-site where I accidentally got my entire team hooked on Suika Game. It was originally called "Subak" (수박), Korean for watermelon.

**Play the original Subak Game → [subak.kempf.dev](https://subak.kempf.dev)**

---

## Gameplay

<img
  src="static/images/subak-game-screenshot.png"
  alt="Fruity Jibesh gameplay screenshot showing many fruit in the gameplay area"
  width="420"
/>

- **Drop** a fruit anywhere along the top of the container.
- **Merge** — when two identical fruits collide, they fuse into the next-larger fruit and award points.
- **Game over** when any fruit breaches the danger line at the top.
- **Customize fruits** — change fruit names, images, and audio; audio can be uploaded or recorded as MP3.
- **Save and load presets** — keep named presets in this browser, including their fruit names, images, and audio.
- **Share presets** — export a PNG image with the preset data embedded, or import one shared by another player.
- **Preset start screen** — choose a recent preset, browse quick tips, and review the game instructions before starting.
- **Offline Support** — no backend or analytics requests; game pages and assets (including physics WASM and audio) are cached via a service worker.
- **Local high scores** — scores are saved on your device with IndexedDB.
- **Installable PWA** — can be installed as a standalone application on mobile and desktop devices.

Preset details stay on the device: small metadata is stored in `localStorage`, while images and audio are stored in IndexedDB. Exported PNG images display import instructions and bundle preset names, fruit custom names, images, and MP3 audio for sharing. Previously exported PDF and `.arjcfruits` files can still be imported.

---

## Architecture

The project serves two roles:

| Mode | Description |
|---|---|
| **Standalone app** | A full SvelteKit single-page app deployed as a static site via `@sveltejs/adapter-static`. |
| **Embeddable library** | Published as an npm package exporting a `SubakGame` Svelte component (`import { SubakGame } from 'subak-game'`). |

### Key modules

```
src/
├── lib/
│   ├── components/           # UI layer (game, start screen, score modal, merge effects)
│   ├── game/                 # Physics-layer classes
│   │   ├── Fruit.ts          #   Fruit rigid-body wrapper (Rapier colliders, merging)
│   │   ├── Boundary.ts       #   Wall / floor collider creation
│   │   └── AudioManager.svelte.ts  #   Sound effect management via Howler
│   ├── hooks/                # Reactive utilities (useBoundingRect, useCursorPosition)
│   ├── stores/
│   │   ├── game.svelte.ts    #   Core GameState class — physics loop, collision detection,
│   │   │                     #   score tracking, fruit spawning, game-over logic
│   │   ├── db.ts             #   High scores and customization assets (Dexie / IndexedDB)
│   ├── icons/ & images/      # UI icons and local fruit PNGs
│   └── types/                # Shared TypeScript interfaces
├── routes/                   # SvelteKit page entry point
```

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| **UI** | [Svelte 5](https://svelte.dev) | Fine-grained reactivity via `$state` runes, minimal runtime overhead |
| **Physics** | [Rapier (rapier2d-compat)](https://rapier.rs) | WASM-powered 2D rigid-body simulation with deterministic collision events |
| **Audio** | [Howler](https://howlerjs.com) | Cross-browser sound playback with volume and pitch control |
| **Local storage** | [Dexie](https://dexie.org) | IndexedDB persistence for high scores, images, sounds, and preset assets |
| **Build** | [Vite](https://vite.dev) + [SvelteKit](https://svelte.dev/docs/kit) | Fast HMR, SSG via `adapter-static`, library mode via `svelte-package` |
| **Linting** | [Biome](https://biomejs.dev) | Formatting and linting in a single tool |
| **Testing** | [Vitest](https://vitest.dev) (browser mode) + [Playwright](https://playwright.dev) | Real-browser test execution with `@testing-library/svelte` |
| **Type checking** | [TypeScript](https://typescriptlang.org) + `svelte-check` | Full strict-mode type safety across `.ts` and `.svelte` files |

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Fauntleroy/subak-game.git
cd subak-game
npm install
```

### 2. Run the dev server

```bash
npm run dev
```

Open **http://localhost:4032** (port `4032` = PLU code of 수박 🍉).

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build → `build/` (static site) + `dist/` (library package) |
| `npm run preview` | Preview the production build locally |
| `npm run check` | Run `svelte-check` for type errors |
| `npm run lint` | Lint with Biome |
| `npm run format` | Auto-format with Biome |
| `npm run test` | Run Vitest (browser mode, headless Chromium) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run validate` | **Full CI gate** — format → lint → test → check |

---

## Testing

Tests run in **Vitest browser mode** using Playwright (headless Chromium) for real DOM and browser API access.

```bash
npm run test            # single run
npm run test:watch      # watch mode
```

Test files live alongside their source code in `__tests__/` directories, covering components, game engine classes, stores, and hooks.

---

## Building & Deployment

### Static site (GitHub Pages)

```bash
npm run build
```

The SvelteKit static adapter outputs to `build/`. The `docs/` directory contains a pre-built snapshot served via GitHub Pages at **[subak.kempf.dev](https://subak.kempf.dev)**.

### Library package

```bash
npm run prepack
```

Outputs the publishable Svelte component library to `dist/`. Consumers import the game as:

```svelte
<script>
  import { SubakGame } from 'subak-game';
</script>

<SubakGame />
```

---

## Project Structure

```
subak-game/
├── src/
│   ├── lib/              # Core library — components, game engine, stores, hooks
│   ├── routes/           # SvelteKit app entry point
├── static/               # Static assets (images, sounds, favicon)
├── design/               # Source design files (Affinity Designer)
├── docs/                 # Pre-built static site for GitHub Pages
├── dist/                 # Compiled library package output
├── biome.json            # Biome linter/formatter config
├── svelte.config.js      # SvelteKit config (static adapter)
├── vite.config.ts        # Vite config (dev server, build)
├── vitest.config.ts      # Vitest config (browser mode, Playwright)
└── tsconfig.json         # TypeScript config
```

---

## Contributing

Contributions are welcome! If you have ideas for improvements, new features, or bug fixes, feel free to open an issue or submit a pull request.

---

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International License** (CC BY-NC 4.0). See [LICENSE.md](LICENSE.md) for details.
