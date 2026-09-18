# Production Release Checklist

Last reviewed: September 18, 2026.

Sylva Signer is published as a public source repository under the root MIT License,
with third-party components remaining under the licenses documented in
`THIRD_PARTY_NOTICES.md`. The production site is
`https://sylva.antonp29.dev`.

## Before Production Updates

1. Confirm that `public/icon-light.png` and `public/icon-dark.png` remain project
   artwork or assets you have permission to redistribute under MIT.
2. Run the verification commands:

   ```powershell
   npm ci
   npm run licenses:check
   npm audit --audit-level=moderate
   npm run build
   npm run wasm:smoke
   npm run test:e2e
   ```

3. Review tracked signing-related files:

   ```powershell
   git ls-files | Select-String -Pattern '\.(p12|pfx|cer|der|key|pem|mobileprovision|provisionprofile|ipa)$'
   ```

   Only `tests/fixtures/Example.ipa`, a 15-byte synthetic placeholder, should
   appear. Never publish real certificates, profiles, private keys, or apps.

4. Review Git history as well as the current tree. `.gitignore` does not remove
   material that was committed previously.
5. Keep `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`,
   `public/fonts/inter/OFL.txt`, and `vendor/zsign/LICENSE` in releases and
   source archives.
6. Confirm that the README's dependency table still matches `package.json` and
   that optional Litterbox/Palera/Sylva Worker behavior is accurately described,
   including Palera as the default manifest provider, the first-party manifest backup,
   the 100 MB proxy limit, and fallbacks.

## Repository Presentation

- Suggested description: `Fully local IPA signing in the browser using a WebAssembly
  port of zsign.`
- Suggested topics: `webassembly`, `emscripten`, `ios`, `ipa`, `codesigning`,
  `react`, `typescript`, `privacy`.
- Link the deployed static site only from domains you control and trust. A hosted
  browser application necessarily exposes its JavaScript and WASM assets to visitors.

## Scope Of The MIT License

MIT covers Sylva Signer's original code and project-owned branding. It does not
replace the licenses of zsign, OpenSSL, zlib/minizip, Inter, npm packages, or
other third parties. Service names and Apple marks are used only for factual
identification and do not imply affiliation or endorsement.

This checklist is a practical project-maintenance aid and is not legal advice.
