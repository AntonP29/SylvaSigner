<p align="center">
  <img src="public/icon-dark.png" alt="Sylva Signer" width="128" />
</p>

<h1 align="center">Sylva Signer</h1>

<p align="center">
  A privacy-focused proof of concept for signing IPA files locally in a browser.
</p>

Production site: [sylva.antonp29.dev](https://sylva.antonp29.dev)

Sylva Signer runs a WebAssembly port of
[`zhlynn/zsign`](https://github.com/zhlynn/zsign) inside a dedicated Web Worker.
Signing does not require an upload or signing server: the IPA, certificate, provisioning
profile, password, injected dylibs, and signed output are processed on the user's device.

An optional post-sign installation flow can temporarily upload **only the signed IPA**
to [Litterbox](https://litterbox.catbox.moe/) and generate an iOS installation manifest
through Palera. Small uploads are relayed through the Sylva Cloudflare Worker for upload
progress; larger uploads keep the direct browser-to-Litterbox path. This action is
separate from local signing and requires explicit user confirmation.

Made by [AntonP29](https://github.com/AntonP29). Project status: `August 9, 2026`.

## Features

- Local IPA signing with zsign compiled to WebAssembly.
- Dedicated browser worker so signing does not block the interface.
- Opt-in iOS/Android compatibility mode using Blob-backed WORKERFS input, a smaller
  initial WASM heap, upstream native minizip, low compression, and direct output-buffer
  transfer to reduce duplicate memory.
- Streaming ZIP extraction with bounded parallel decompression and native browser
  decompression streams when available, followed by zsign-native IPA archiving.
- Exact-size MEMFS allocation to reduce transient extraction memory spikes.
- Conventional non-ZIP64 IPA output with explicit directory records for iOS installer
  compatibility.
- Live, internally scrolling zsign console output.
- Transient animated `WAIT` status with byte-based extraction progress and indeterminate
  native archive activity, making long local operations visibly active without polluting logs.
- Signing-stage progress based on zsign log milestones.
- IPA, P12/PFX, provisioning profile, optional dylib, password, output name, and bundle
  ID controls.
- Optional IPA URL import through the Sylva Cloudflare Worker (no size limit for remote imports),
  with direct browser download fallback if the proxy fails.
- Optional NexCerts helper that reads the live README table, displays only public
  enterprise certificate rows currently marked `✅ Signed`, and imports the selected
  `.p12`, provisioning profile, and password directly from GitHub into the browser.
- Dylib injection stages selected `.dylib` files in writable browser memory before
  zsign validation, matching upstream zsign's read-write Mach-O mapping behavior.
- Selected dylibs are inspected locally as Mach-O files and summarized by architecture,
  binary type, minimum iOS version, dependency count, and install-name basename.
- Automatic app name, bundle ID, version, artwork, and IPA-size extraction when an IPA
  is selected; the detected bundle ID is loaded into the editable bundle-ID field.
- Browser decoding for standard and Apple-optimized `CgBI` app icon PNGs, including
  channel correction and alpha unpremultiplication before thumbnail generation.
- Local P12 certificate common-name/expiration parsing and provisioning-profile
  name/expiration details in the app summary tile.
- Output names default to the input name with `_signed` appended.
- Signed IPAs use zsign's native minizip writer and compressed output for parity with the
  upstream CLI and iOS installation tooling.
- Optional P12/profile/password cache stored in browser IndexedDB.
- Cached signing files and password are restored into the visible controls on reload.
- Browser-local `Previous IPAs` history with `Fully Local`, `Active`, and `Expired`
  states, app artwork, and active install QR codes retained until their links expire.
- Local download of the signed IPA.
- Optional QR/direct iPhone install flow using Litterbox and Palera, with measured upload
  progress for signed IPAs up to 100 MB through the Sylva Cloudflare Worker.
- Temporary hosting choices of `1h`, `12h`, `24h`, or `72h`.
- Responsive light/dark interface, animated controls, matching favicons, an animated
  Sylva welcome mark, and locally bundled Inter variable fonts.
- Privacy Policy and Legal pages in the footer.

The public UI intentionally focuses on the common signing workflow. Lower-level zsign
options remain available through the TypeScript API and worker wrapper.

## Privacy Model

### Local signing

The following remain on the device during normal signing and local download:

- Original IPA
- P12/PFX certificate and private key material
- Provisioning profile
- Certificate password
- Injected dylibs
- Signed IPA output

The app downloads its code and WASM runtime from the host, then executes zsign in the
browser worker. Use a deployment and domain you trust.

### Optional certificate cache

When `Cache certificate locally` is enabled, the certificate, provisioning profiles,
and password are saved in this browser's IndexedDB. This data is not uploaded by Sylva
Signer, but it is also not separately encrypted by the app. Do not enable caching on a
shared or untrusted browser profile. `Forget cached certificate` removes the saved data.

### Optional public certificate import

The public enterprise certificate helper fetches the NexCerts README in the browser and
filters the table to entries currently marked `✅ Signed`. Revoked entries are not shown.
When a listed certificate is imported, Sylva downloads that public `.p12`, provisioning
profile, and password from GitHub into the same local input controls used for manual files.

These files are third-party public signing assets. They can be revoked by Apple or the
certificate owner at any time, and use of shared enterprise certificates must comply with
Apple's terms, the certificate owner's rights, and applicable rules for your situation.

### Previous IPA history

History is stored in browser `localStorage` and keeps:

- Signed output name and signing time
- Detected bundle metadata when available
- Compact app artwork thumbnail when available
- Temporary IPA/manifest/install URLs when installation hosting was used
- Selected temporary-host duration and calculated expiration time

Signed IPA bytes are **not** retained in history. A `Fully Local` entry therefore has no
copy-link actions and cannot be downloaded again after the in-memory output is gone.
`Active` and `Expired` are calculated locally from the selected duration; Sylva does not
poll Litterbox to verify remote file availability.

### Optional iPhone installation

Temporary installation is not fully local. After confirmation:

1. The already-signed IPA is uploaded over HTTPS. Signed IPAs up to 100 MB are sent
   through `https://sylvacors.antonp29.dev/litterbox` so Sylva can show upload progress;
   larger signed IPAs use the direct browser-to-Litterbox path.
2. The original IPA, P12, provisioning profile, password, and dylibs are not uploaded.
3. Sylva sends app metadata and the temporary IPA URL to Palera's manifest generator.
4. Desktop browsers receive an `itms-services://` QR code and install link. On iPhone or
   iPad, Sylva instead presents a direct **Install on iPhone** button after upload.

The temporary IPA URL is public to anyone who possesses it until it expires. Litterbox
accepts files up to **1 GB**; Sylva rejects larger upload attempts before sending them.

### Optional IPA URL import

When an IPA URL is entered, Sylva first asks the Sylva Cloudflare Worker at
`https://sylvacors.antonp29.dev/ipa?url=...` to fetch it. The Worker only permits browser
requests from `https://sylva.antonp29.dev` and blocks obvious local/private-network targets.
The download via the proxy has no size limit (outbound streaming from Cloudflare Workers is not
restricted to 100 MB). If the proxy download fails for any reason, Sylva falls back to the direct
browser download path. The downloaded IPA is then handled like a manually selected local file.

## Browser Workflow

1. Open Sylva Signer and review the welcome notice.
2. Select an `.ipa` file, or paste an IPA URL and import it.
3. Select a `.p12` or `.pfx` signing certificate.
4. Select one or more `.mobileprovision` files.
5. Enter the certificate password. Alternatively, use the public enterprise certificate
   helper to import a NexCerts row currently marked signed.
6. Optionally select dylibs to inject or edit the detected bundle ID.
7. Optionally enable local certificate caching.
8. Click `Sign IPA` and keep the tab open while the worker runs. Mobile browsers scroll
   directly to the live console before the signing worker starts.
9. Download the signed IPA locally.
10. Optionally choose `Install QR` on desktop or `Install on iPhone` on iOS, review the
    limitations, and approve temporary hosting.

Large IPAs can still take significant time because extraction, signing, and re-archiving
use the device's CPU and storage. Sylva streams ZIP entries through browser decompression
APIs and uses bounded parallel extraction. The stable signing path currently keeps the
extracted tree in WebAssembly memory, so keep the tab open and leave several times the
IPA size available as free memory. The OPFS runtime remains experimental and is not
selected automatically because its asynchronous filesystem can destabilize full signing.

In a local Chromium comparison using a 93.06 MB IPA with 10,691 ZIP entries (about
233 MB extracted), zsign's previous WASM extraction path took 263.2 seconds. The bounded
browser extraction path completed in about 20.6 seconds, after which signing and archive
creation remain in upstream zsign. Results vary by device and IPA structure.

The signed IPA may still differ modestly in size from the input because Mach-O code
signature regions can grow and the archive is recompressed. Archive creation is delegated
back to zsign's minizip implementation so file order, directory records, flags, attributes,
and compression behavior match the upstream CLI.

## Previous IPAs

The `Previous IPAs` button beside the theme control opens local signing history.

- `Fully Local`: the IPA was signed but never temporarily hosted. No URL buttons appear.
- `Active`: the locally calculated Litterbox expiration time has not passed.
- `Expired`: the selected Litterbox duration has elapsed.
- `Copy Download URL`: copies the temporary Litterbox IPA URL.
- `Copy iPhone Install Link`: copies the generated `itms-services://` link.
- Active entries display their install QR until the calculated link expiration time.
- On iPhone and iPad, active entries display a direct installation button instead of a QR.

Clearing history removes these local records and URLs. It does not control files already
uploaded to Litterbox.

## Temporary Install Limitations

- Maximum temporary upload size is 1 GB.
- Signed IPAs up to 100 MB are uploaded through the Sylva Cloudflare Worker for progress
  reporting. Larger signed IPAs use the direct Litterbox path.
- Temporary durations are controlled by Litterbox.
- The signed IPA is publicly accessible to anyone with its temporary URL.
- Installation depends on Litterbox, Palera, Apple OTA behavior, device trust, and the
  signing certificate/provisioning profile.
- Some networks or regions may block Catbox/Litterbox.
- The upload bar is determinate when the Sylva Worker path is used. It measures upload
  progress to the Worker; the Worker still has to finish forwarding the file to Litterbox.
- Direct Litterbox uploads remain indeterminate because browser upload progress listeners
  force a CORS preflight that Litterbox does not reliably accept.
- Blob URLs and localhost URLs are not suitable for installation on a separate iPhone.

## Quick Start

Requirements:

- Node.js with npm
- Current desktop Chromium-based browser recommended
- Current iOS/Android browser for experimental mobile compatibility mode

```powershell
npm install
npm run dev
```

Open the Vite URL, normally:

```text
http://localhost:5173
```

The committed WASM runtime is sufficient for normal development. You do not need to
install Emscripten or rebuild OpenSSL to run the app from a fresh clone.

## Production Build

```powershell
npm install
npm run build
```

Deploy the generated `dist/` directory to an HTTPS static host.

Recommended Vercel settings:

```text
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

Required content types:

```text
.wasm    application/wasm
.js/.mjs text/javascript or application/javascript
```

No application backend is required for signing. Network access is used for loading the
hosted static app, optional public certificate import, optional IPA URL import through
`https://sylvacors.antonp29.dev`, and the explicitly approved temporary installation flow.

## TypeScript Interfaces

The worker API is available in [`src/zsign-api.ts`](src/zsign-api.ts):

- `runZsign(args, files, options)` runs zsign-style arguments against browser files and
  returns logs, exit code, and collected output files.
- `signIpa(options, runOptions)` provides the higher-level IPA signing interface.
- `saveOutput(output)` downloads a returned output file through the browser.
- `runOptions.storageMode: "mobile-native"` selects the low-copy WORKERFS/native-minizip
  pipeline in a minimal classic worker used on mobile browsers.

`SignIpaOptions` retains the broader zsign option surface even though the main interface
shows only the common workflow.

## Rebuilding WASM

Committed runtime files:

```text
public/wasm/zsign.mjs
public/wasm/zsign.wasm
public/wasm/zsign-mobile.mjs
public/wasm/zsign-mobile.js
public/wasm/zsign-mobile.wasm
public/wasm/zsign-opfs.mjs
public/wasm/zsign-opfs.wasm
```

Rebuild only when zsign, OpenSSL, Emscripten, or the browser patches change:

```powershell
npm install
npm run setup:emsdk
npm run build:openssl
npm run build:wasm
npm run wasm:smoke
npm run build
```

Pinned inputs:

- Emscripten `6.0.0`
- OpenSSL `3.5.7`
- zsign commit `28a6421`

The desktop build uses `WORKERFS` for certificate inputs, browser ZIP extraction into
MEMFS, and `IDBFS` for the persistent zsign cache. The mobile-native build keeps the IPA
as a WORKERFS-backed browser Blob and delegates extraction and archive creation to upstream
zsign in a classic worker that does not import the app's zip.js worker bundle. It starts
with a 16.625 MiB WASM heap, caps growth at 512 MiB, transfers the final MEMFS output
buffer without an additional read copy, and wraps it once as a reusable browser Blob. The
mobile UI paints its initial status before
starting the worker and pauses decorative animation while signing. The experimental OPFS
build uses WasmFS and Asyncify,
but automatic selection is disabled until full signing is reliable on that backend.
Browser-specific patches and upstream details are documented in
[`docs/UPSTREAM.md`](docs/UPSTREAM.md) and [`docs/WASM_BUILD.md`](docs/WASM_BUILD.md).

## Verification

```powershell
npm run build
npm run wasm:smoke
npm run test:e2e
```

The Playwright suite verifies the Sylva work surface, welcome notice, standard and CgBI
app metadata/artwork extraction, bundle-ID autofill, local P12/profile details, output
naming, IPA URL import through the Sylva proxy, footer pages, active install history,
the desktop archive path, direct mobile access, and a complete mobile-native sign/archive
round trip. Normal page load is checked for unexpected external requests.

## Browser and Platform Limits

- Current desktop Chromium is the primary and most reliable browser target.
- iOS and Android visitors open the signer directly in mobile compatibility mode. Mobile
  completion depends on the IPA's expanded size and the browser's per-tab memory allowance.
- Mobile mode is deliberately slower: it avoids zip.js expansion, reads the IPA through
  WORKERFS in a minimal classic worker, uses upstream zsign/minizip, selects compression
  level 1, and transfers the completed MEMFS file buffer directly before terminating the
  worker. Its WebAssembly heap is capped at 512 MiB to avoid runaway virtual-memory growth.
- The stable path uses WebAssembly memory; the experimental OPFS runtime is not selected
  automatically.
- iOS browsers use Apple's WebKit engine even when branded as Chrome, and both iOS and
  Android browsers can still terminate memory-intensive signing workers without recovery.
- Large IPA performance depends on device CPU, memory, storage, and browser limits.
- Extraction progress is byte-based; native zsign archive activity is indeterminate.
- Litterbox upload progress is measured only for signed IPAs that use the Sylva Worker
  path. Larger direct uploads remain indeterminate for CORS compatibility.
- Native `-i/--install` through `ideviceinstaller` is unsupported in browser-only mode.
- Raw-socket live OCSP checks are unsupported in browser WebAssembly.
- Native `system()` operations are stubbed as unsupported.
- Third-party OTA installation can fail even when signing succeeds.

## Security Notes

- Real signing material and IPA files are excluded by `.gitignore` and must not be
  committed.
- Only synthetic fixtures should be placed in `tests/fixtures/`.
- Browser storage persists until cleared by the app, browser settings, or profile reset.
- Public or private source control does not make hosted client assets secret. Visitors can
  download the JavaScript and zsign WASM runtimes required by their browser.
- Minification or WASM obfuscation cannot prevent a visitor from saving client assets.
- Use only certificates, profiles, dylibs, and applications you are authorized to use.

## Repository Layout

```text
src/                       React UI, worker, zsign API, history, and install helpers
src/components/            Sylva components, UI primitives, and animated icons
public/wasm/               Committed zsign WASM runtime
public/fonts/inter/        Inter variable fonts and the SIL OFL 1.1 license
public/*.png               App icons and favicons
scripts/                   Emscripten, OpenSSL, zsign build, and smoke-test scripts
vendor/zsign/              Vendored upstream zsign source and MIT license
licenses/                  Exact OpenSSL and direct runtime package license texts
docs/                      Upstream and WASM build documentation
tests/e2e/                 Playwright browser tests
tests/fixtures/            Synthetic test fixtures only
```

## License

Sylva Signer's original code and project branding are released under the
[MIT License](LICENSE), copyright 2026 AntonP29. MIT was selected because it is a short,
permissive license compatible with the upstream zsign license. It permits use,
modification, redistribution, sublicensing, and commercial use, provided the copyright
and license notice are retained. It includes no warranty.

Third-party components are **not relicensed** as Sylva code. Their original terms remain
in force. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `licenses/`,
`vendor/zsign/LICENSE`, and `public/fonts/inter/OFL.txt`.

Production maintenance checks are documented in
[`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md).

This licensing inventory is a practical compliance record, not legal advice. The Sylva
logo files are project artwork, and optional external services remain subject to their
own current terms.

## Direct Dependencies

All direct packages are listed here for transparency. `package-lock.json` records exact
versions and transitive packages. Exact direct runtime license texts are preserved under
`licenses/npm/`.

The animated icon components under `src/components/animate-ui/` are adapted
from [Animate UI](https://animate-ui.com/) and use Lucide icon geometry. Animate
UI is distributed here as part of the application under its MIT plus Commons
Clause terms; the exact license and component notice are preserved at
`licenses/animate-ui.txt` and `src/components/animate-ui/NOTICE.md`.

| Runtime package | Purpose | License |
| --- | --- | --- |
| `@base-ui/react` | Accessible UI primitives | MIT |
| `@plist/binary.parse` | Binary Apple plist parsing | BSD-3-Clause-Clear |
| `@vercel/analytics` | Production web analytics | MIT |
| `@vercel/speed-insights` | Production web performance metrics | Apache-2.0 |
| `@zip.js/zip.js` | Browser ZIP entry reading and extraction | BSD-3-Clause |
| `class-variance-authority` | Component variant composition | Apache-2.0 |
| `clsx` | Conditional class names | MIT |
| `lucide-react` | Interface icon primitives used by the animated icon set | ISC; selected Feather-derived icons also retain MIT notices |
| `motion` | Interface animation runtime | MIT |
| `node-forge` | Local PKCS#12 certificate metadata parsing | BSD-3-Clause option selected |
| `qrcode` | Local install QR generation | MIT |
| `react`, `react-dom` | User-interface runtime | MIT |
| `shadcn` | UI styling/tooling support | MIT |
| `tailwindcss`, `tailwind-merge`, `tw-animate-css` | Styling and animation utilities | MIT |

| Development package | Purpose | License |
| --- | --- | --- |
| `@playwright/test` | Chromium acceptance tests | Apache-2.0 |
| `@tailwindcss/vite` | Tailwind Vite integration | MIT |
| `@types/node`, `@types/node-forge`, `@types/qrcode`, `@types/react`, `@types/react-dom` | TypeScript declarations | MIT |
| `@vitejs/plugin-react` | React build integration | MIT |
| `typescript` | Type checking | Apache-2.0 |
| `vite` | Development server and production bundler | MIT |

Inter is licensed separately under SIL OFL 1.1. The native/WASM signing stack additionally
uses zsign (MIT), zlib/minizip (zlib terms), OpenSSL 3.5.7 (Apache-2.0), and Emscripten
6.0.0 (MIT and University of Illinois/NCSA terms).

## Attribution

- Powered by [`zsign`](https://github.com/zhlynn/zsign), with a privacy-focused WebAssembly
  port for this browser proof of concept.
- Optional public enterprise certificate listings are read at runtime from
  [NexCerts](https://github.com/NovaDev404/NexCerts). Certificate files are not
  vendored in this repository.
- Optional temporary IPA hosting is provided by
  [Litterbox](https://litterbox.catbox.moe/).
- Optional IPA URL import and small signed-IPA upload progress use the Sylva Cloudflare
  Worker at `https://sylvacors.antonp29.dev`.
- Animated interface icons are adapted from [Animate UI](https://animate-ui.com/)
  and use [Lucide](https://lucide.dev/) icon geometry.
- Created by [AntonP29](https://github.com/AntonP29).

See the in-app Privacy Policy and Legal pages before using Sylva Signer for distribution
workflows.
