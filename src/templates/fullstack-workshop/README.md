# Fullstack Workshop — Soroban Counter + React UI

A complete fullstack starter for Stellar Soroban: a Rust smart contract,
plus a TypeScript + React frontend that reads and writes to it through the
Stellar SDK and a browser wallet (Freighter).

```
fullstack-workshop/
├── contracts/
│   └── counter/        # Soroban smart contract (Rust)
│       ├── Cargo.toml
│       └── src/lib.rs
├── frontend/           # Vite + React + TypeScript app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── sorobanClient.ts
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── .env.example
├── Cargo.toml          # Workspace manifest
└── README.md
```

## What you'll build

A tiny counter contract with `get`, `increment`, `decrement`, and `reset`
methods — and a clean React UI that calls those methods using a connected
Stellar wallet on the Soroban testnet.

## Recommended path — Run in IDE, then ship to Vercel

The IDE has a fully in-browser bundler. You write code, click **Run in
IDE**, and the site loads in the Preview panel — no Node install, no
terminal, no `localhost:5173`. When you're happy, **Vercel** publishes
the same app to a sharable public URL.

### Run in IDE (zero setup)

1. Open the **Fullstack** panel (triangle icon). The default tab is
   **Local**.
2. **Deploy the contract** from the **Deploy** panel (rocket icon). After
   it succeeds, return to the Fullstack panel — a "Contract deployed"
   banner appears with a **Save to .env** button. One click writes
   `VITE_CONTRACT_ID` and `VITE_NETWORK` into `frontend/.env`.
3. Click the big **Run in IDE** button. The IDE:
   - Reads every file under `frontend/` out of memory.
   - Compiles TypeScript / JSX with esbuild-wasm running entirely in
     your browser (~3 MB one-time download).
   - Resolves `react`, `react-dom`, `@stellar/stellar-sdk`,
     `@stellar/freighter-api` and friends through `esm.sh`.
   - Splices the result into your `index.html` as inline ES modules and
     frames the result.
4. The Preview panel opens automatically and shows your app. Edits to
   any frontend file → click **Rebuild** (top right) and see the change
   in ~1 second.

### Vercel (one-click public URL)

When the in-IDE preview looks good:

1. Switch the Fullstack panel's tab from **Local** to **Vercel**.
2. Click **Connect with Vercel** and sign in via the popup.
3. The "Contract deployed" banner offers **Auto-fill and deploy** — one
   click writes the env vars and opens the deploy modal with the right
   values pre-filled.
4. Hit **Deploy**. When the build finishes, the Preview panel auto-switches
   to the **Deployed** tab and frames your live site.

## Long path — full manual control

### Step 1 — Build & deploy the contract

1. Open the **Deploy** panel (rocket icon in the sidebar).
2. Pick the `contracts/counter` contract.
3. Click **Build Contract**. Wait for the green check.
4. Connect Freighter (set its network to **Testnet** first).
5. Click **Deploy**. Copy the resulting contract ID once it's printed.

### Step 2 — Wire the contract ID into the frontend

1. Open `frontend/.env.example` and copy its contents into a new file `frontend/.env`.
2. Replace `VITE_CONTRACT_ID=` with the contract ID you copied in step 1:

   ```env
   VITE_CONTRACT_ID=C…YOUR_CONTRACT_ID…
   VITE_NETWORK=TESTNET
   ```

### Step 3 — Deploy the UI to Vercel

1. Open the **Fullstack** panel (triangle icon).
2. Click **Connect with Vercel** and sign in via the popup.
3. Click **New Deployment**.
4. The source folder picker should already say `frontend/` — that's the
   auto-detected frontend root.
5. Add `VITE_CONTRACT_ID` and `VITE_NETWORK` as environment variables in
   the modal (same values as your `.env` file).
6. Hit **Deploy**. Watch the progress bar; once it says **Ready**, click
   the URL to open your live dApp.

### Step 4 — Try it

Open the live URL, connect Freighter, then:

- **Get** reads the current count from the contract (free, no signing).
- **Increment / Decrement** sign and submit a transaction; the counter
  updates after the network confirms.
- **Reset** zeroes the counter.

## Live preview inside the IDE

Open the **Preview** panel (monitor icon in the sidebar). It exposes two
sources via the toggle at the top.

### Local — in-IDE bundle (default)

This is the new headline path. The Preview panel ships with an
esbuild-wasm bundler that:

- Compiles every file under `frontend/` (TypeScript, JSX, CSS, JSON,
  assets as data URLs).
- Resolves `react`, `react-dom`, `@stellar/stellar-sdk`, etc. through
  `esm.sh` so you don't need a `node_modules/` folder anywhere.
- Reads `VITE_*` variables from `frontend/.env` and inlines them at
  build time (same surface as Vite).
- Wraps the bundle in your existing `index.html`, hands the result back
  as a `blob:` URL, and frames it.

Click **Run in IDE**, wait ~3 seconds for the first build (the wasm
bundler downloads once), and the site appears. After that, every
**Rebuild** is sub-second.

The device-size buttons (Desktop / Tablet / Mobile) constrain the iframe
width so you can sanity-check responsive layouts without leaving the IDE.

> **Limitations** of the in-IDE bundler: it does not run Vite plugins
> (PostCSS, SVGR, etc.), it has no HMR (you rebuild on save), and it
> assumes your imports resolve cleanly to npm packages on esm.sh. For
> very large apps with custom build pipelines, fall back to running
> Vite yourself — see the **Advanced** disclosure in the Fullstack panel.

### Deployed (Vercel)

Click **Deploy and preview** in the Local empty-state hint card (or just
deploy from the Fullstack → Vercel tab). Once the Vercel build is green,
the Preview panel automatically:

1. Switches to the **Deployed** tab.
2. Frames your live site inside the IDE.
3. Updates again every time you redeploy.

Good for sharing a live URL with someone else or smoke-checking your
production build.

## Local development

```bash
cd frontend
npm install
npm run dev          # local vite server on http://localhost:5173
```

Make sure `frontend/.env` is populated, otherwise the UI will display
`VITE_CONTRACT_ID is not set` until you fill it in.

## Notes

- The Soroban contract uses standard `soroban-sdk` v22 syntax.
- The frontend talks to the public Soroban testnet RPC
  (`https://soroban-testnet.stellar.org`). Switch to mainnet by changing
  `VITE_NETWORK=MAINNET` and updating the RPC URL in
  `frontend/src/sorobanClient.ts`.
- The wallet signing flow uses `@stellar/freighter-api` directly; the
  Soroban IDE's Deploy panel uses the same mechanism for contract deploys.
