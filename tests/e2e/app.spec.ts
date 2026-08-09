import { devices, expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import forge from "node-forge";
import { uploadSignedIpaToLitterbox } from "../../src/install-api";
import { parseNexCertsReadme } from "../../src/public-certs";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter
} from "@zip.js/zip.js";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = new Uint8Array()) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.length + 8);
  return chunk;
}

function syntheticCgbiIcon() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const bgraPixel = Buffer.from([0, 20, 90, 200, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("CgBI"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateRawSync(bgraPixel)),
    pngChunk("IEND")
  ]);
}

async function syntheticIpa() {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer, { level: 1, useWebWorkers: false });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Sylva Test</string>
<key>CFBundleExecutable</key><string>SylvaTest</string>
<key>CFBundleIdentifier</key><string>dev.sylva.test</string>
<key>CFBundleName</key><string>SylvaTest</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFiles</key><array><string>AppIcon60x60</string></array>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>`;
  await zip.add("Payload/SylvaTest.app/Info.plist", new TextReader(plist));
  await zip.add(
    "Payload/SylvaTest.app/AppIcon60x60@2x.png",
    new Uint8ArrayReader(syntheticCgbiIcon())
  );
  await zip.add(
    "Payload/SylvaTest.app/SylvaTest",
    new Uint8ArrayReader(readFileSync("vendor/zsign/test/dylib/bin/demo1.dylib")),
    { executable: true }
  );
  return zip.close();
}

function syntheticSigningFiles() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date("2026-01-01T12:00:00Z");
  certificate.validity.notAfter = new Date("2030-06-22T12:00:00Z");
  certificate.setSubject([{ name: "commonName", value: "Sylva Test Certificate" }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], "sylva-test");
  const p12Bytes = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
  const profile = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Name</key><string>Sylva Development Profile</string>
<key>ExpirationDate</key><date>2030-07-23T12:00:00Z</date>
</dict></plist>`);
  return { p12Bytes, profile };
}

const nexCertsFixture = `
--- | Company | Type | Status | Valid From | Valid To | Download | |:--------|:----|:------|:----------|:--------|:--------| | VIETNAM AIRLINES JSC 2 | Enterprise Certificate | ✅ Signed | Aug 8 12:21:46 2025 GMT | Aug 8 12:21:46 2026 GMT | [Download](https://download-directory.github.io/?url=https%3A//github.com/NovaDev404/certificates/tree/main/VIETNAM%2520AIRLINES%2520JSC%25202) | | China Telecom Corporation Limited | Enterprise Certificate | ❌ Revoked | Apr 23 08:44:02 2026 GMT | Apr 23 08:44:02 2027 GMT | [Download](https://download-directory.github.io/?url=https%3A//github.com/NovaDev404/certificates/tree/main/China%2520Telecom%2520Corporation%2520Limited) |
`;

test("emits crawlable HTML and SEO discovery files", () => {
  const homepage = readFileSync("dist/index.html", "utf8");
  const privacy = readFileSync("dist/privacy/index.html", "utf8");
  const legal = readFileSync("dist/legal/index.html", "utf8");
  const robots = readFileSync("dist/robots.txt", "utf8");
  const sitemap = readFileSync("dist/sitemap.xml", "utf8");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

  expect(homepage).not.toContain('<div id="app"></div>');
  expect(homepage).toContain("Sign iOS IPA files locally in your browser");
  expect(homepage).toContain("Frequently asked questions");
  expect(homepage).toContain('rel="canonical" href="https://sylva.antonp29.dev/"');
  expect(homepage).toContain('property="og:image" content="https://sylva.antonp29.dev/og.png"');
  expect(homepage).toContain('"@type": "SoftwareApplication"');
  expect(homepage).toContain('"@type": "HowTo"');
  expect(homepage).toContain('"@type": "FAQPage"');
  expect(privacy).toContain("Privacy Policy - Sylva Signer");
  expect(privacy).toContain('href="https://sylva.antonp29.dev/privacy/"');
  expect(privacy).toContain(
    'property="og:description" content="Learn how Sylva Signer processes IPA files, certificates, provisioning profiles, passwords, and signed output locally in your browser."'
  );
  expect(privacy).toContain('<h1 class="text-2xl font-semibold tracking-tight">');
  expect(privacy).toContain('dateTime="2026-08-09"');
  expect(legal).toContain("Legal Notice - Sylva Signer");
  expect(legal).toContain('href="https://sylva.antonp29.dev/legal/"');
  expect(legal).toContain(
    'property="og:description" content="Read the Sylva Signer legal notice, licensing information, permitted-use guidance, and third-party attribution."'
  );
  expect(robots).toContain("Sitemap: https://sylva.antonp29.dev/sitemap.xml");
  expect(sitemap).toContain("https://sylva.antonp29.dev/privacy/");
  expect(vercel.redirects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "/privacy", destination: "/privacy/", permanent: true }),
      expect.objectContaining({ source: "/legal", destination: "/legal/", permanent: true })
    ])
  );
});

test("parses only currently signed NexCerts enterprise certificates", () => {
  const entries = parseNexCertsReadme(nexCertsFixture);

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    company: "VIETNAM AIRLINES JSC 2",
    type: "Enterprise Certificate",
    status: "Signed",
    validTo: "Aug 8 12:21:46 2026 GMT",
    repository: "NovaDev404/certificates",
    directoryPath: "VIETNAM AIRLINES JSC 2"
  });
});

test("uploads small signed IPAs through the Sylva proxy", async () => {
  const runtime = globalThis as typeof globalThis & {
    navigator: Navigator;
    XMLHttpRequest: typeof XMLHttpRequest;
  };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const xhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  let opened = "";
  let sentForm: FormData | undefined;

  class FakeXmlHttpRequest {
    status = 200;
    responseText = "https://litter.catbox.moe/mobile-test.ipa\n";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };

    open(method: string, url: string) {
      opened = `${method} ${url}`;
    }

    send(form: FormData) {
      sentForm = form;
      queueMicrotask(() => this.onload?.());
    }
  }

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)",
      maxTouchPoints: 5
    }
  });
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: FakeXmlHttpRequest
  });

  try {
    const result = await uploadSignedIpaToLitterbox({
      path: "/output/test.ipa",
      name: "test.ipa",
      type: "application/zip",
      data: new Blob(["test"])
    });
    expect(opened).toBe("POST https://sylvacors.antonp29.dev/litterbox");
    expect(result).toBe("https://litter.catbox.moe/mobile-test.ipa");
    expect(sentForm).toBeInstanceOf(FormData);
    expect((sentForm?.get("fileToUpload") as File).name).toBe("test.ipa");
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (runtime as { navigator?: Navigator }).navigator;
    if (xhrDescriptor) Object.defineProperty(globalThis, "XMLHttpRequest", xhrDescriptor);
    else delete (runtime as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  }
});

test("loads the exact Sylva signing work surface without unexpected external requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const expectedReleaseRequest =
      request.url() === "https://api.github.com/repos/AntonP29/Sylva-iOS-Releases/releases";
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !expectedReleaseRequest) {
      external.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Sylva Signer/ })).toBeVisible();
  await expect(page.getByText("Private by design")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "About Sylva Signer" }).click();
  await expect(page.getByRole("heading", { name: "Hey there 👋" })).toBeVisible();
  await expect(page.getByText(/^\w+ \d{1,2}(?:st|nd|rd|th), \d{4}$/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Fully local IPA signing in your browser")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous IPAs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Sylva Signer on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/AntonP29/SylvaSigner"
  );
  await expect(page.getByRole("button", { name: "Sign IPA" })).toBeDisabled();
  await expect(page.locator("#ipa")).toBeAttached();
  await expect(page.locator("#p12")).toBeAttached();
  await expect(page.locator("#profiles")).toHaveAttribute("multiple", "");
  await expect(page.locator("#dylibs")).toHaveAttribute("multiple", "");
  await expect(page.getByText("Cache certificate locally")).toBeVisible();
  await expect(page.locator("#bundle-id")).toBeVisible();
  await expect(page.getByText("Console")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy logs" })).toBeVisible();
  await expect(page.getByText("Sylva Signer runs zsign as WebAssembly inside a dedicated browser worker.").first()).toBeVisible();
  await expect(page.getByText("Install QR")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("derives output name from selected IPA and keeps live logs visible", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#ipa", "tests/fixtures/Example.ipa");
  await expect(page.locator("#output-name")).toHaveValue("Example_signed.ipa");
  await expect(page.getByText("Waiting for input. Drop your files and press Sign.")).toBeVisible();
});

test("imports an IPA from a URL and selects it for signing", async ({ page }) => {
  const ipa = await syntheticIpa();
  await page.route("https://sylvacors.antonp29.dev/ipa**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("url")).toContain("/remote-test.ipa");
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: {
        "content-length": String(ipa.length)
      },
      body: Buffer.from(ipa)
    });
  });

  await page.goto("/");
  const remoteUrl = `${new URL(page.url()).origin}/remote-test.ipa`;
  await page.getByLabel("IPA URL").fill(remoteUrl);
  await page.getByRole("button", { name: "Import URL" }).click();

  await expect(page.locator("#output-name")).toHaveValue("remote-test_signed.ipa");
  await expect(page.getByRole("button", { name: /remote-test\.ipa/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sylva Test" })).toBeVisible();
  await expect(page.locator("#bundle-id")).toHaveValue("dev.sylva.test");
});

test("extracts app metadata and fills the bundle ID when an IPA is selected", async ({ page }) => {
  await page.goto("/");
  const ipa = await syntheticIpa();
  await page.setInputFiles("#ipa", {
    name: "SylvaTest.ipa",
    mimeType: "application/zip",
    buffer: Buffer.from(ipa)
  });

  await expect(page.getByRole("heading", { name: "Sylva Test" })).toBeVisible();
  await expect(page.getByText("dev.sylva.test", { exact: true })).toBeVisible();
  await expect(page.locator("#bundle-id")).toHaveValue("dev.sylva.test");
  const icon = page.getByAltText("Sylva Test icon");
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("1.0", { exact: true })).toBeVisible();

  await page.setInputFiles("#dylibs", [
    "vendor/zsign/test/dylib/bin/demo1.dylib",
    "vendor/zsign/test/dylib/bin/demo2.dylib"
  ]);
  await expect(page.getByText("Dylib injection")).toBeVisible();
  await expect(page.getByText("2 dylibs selected")).toBeVisible();
  await expect(page.getByText("demo1.dylib").nth(1)).toBeVisible();
  await expect(page.getByText("demo2.dylib").first()).toBeVisible();
  await expect(page.getByText("50 KB").first()).toBeVisible();
  await expect(page.getByText("Dynamic library · arm64").first()).toBeVisible();
  await expect(page.getByText("iOS 7.0+").first()).toBeVisible();
  await expect(page.getByText("5 linked libraries").first()).toBeVisible();
  await expect(page.getByText("demo.dylib").first()).toBeVisible();
});

test("shows certificate and provisioning expiration details locally", async ({ page }) => {
  const { p12Bytes, profile } = syntheticSigningFiles();
  await page.goto("/");
  const ipa = await syntheticIpa();
  await page.setInputFiles("#ipa", {
    name: "SylvaTest.ipa",
    mimeType: "application/zip",
    buffer: Buffer.from(ipa)
  });
  await page.setInputFiles("#p12", {
    name: "sylva-test.p12",
    mimeType: "application/x-pkcs12",
    buffer: p12Bytes
  });
  await page.setInputFiles("#profiles", {
    name: "sylva-test.mobileprovision",
    mimeType: "application/octet-stream",
    buffer: profile
  });
  await page.locator("#cert-password").fill("sylva-test");

  await expect(page.getByText("Sylva Test Certificate", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires Jun 22, 2030", { exact: true })).toBeVisible();
  await expect(page.getByText("Sylva Development Profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires Jul 23, 2030", { exact: true })).toBeVisible();

  await page.locator("#cert-password").fill("temporarily-wrong");
  await expect(page.getByText("Sylva Test Certificate", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires Jun 22, 2030", { exact: true })).toBeVisible();
});

test("imports only signed public enterprise certificates from NexCerts", async ({ page }) => {
  await page.route(
    "https://raw.githubusercontent.com/NovaDev404/NexCerts/main/README.md",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/markdown",
        body: nexCertsFixture
      })
  );
  await page.route(
    /https:\/\/api\.github\.com\/repos\/NovaDev404\/(?:certificates|NexCerts)\/contents\/VIETNAM%20AIRLINES%20JSC%202\?ref=main/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            name: "VIETNAM AIRLINES JSC 2.p12",
            type: "file",
            download_url:
              "https://raw.githubusercontent.com/NovaDev404/certificates/main/VIETNAM%20AIRLINES%20JSC%202/VIETNAM%20AIRLINES%20JSC%202.p12"
          },
          {
            name: "VIETNAM AIRLINES JSC 2.mobileprovision",
            type: "file",
            download_url:
              "https://raw.githubusercontent.com/NovaDev404/certificates/main/VIETNAM%20AIRLINES%20JSC%202/VIETNAM%20AIRLINES%20JSC%202.mobileprovision"
          },
          {
            name: "password.txt",
            type: "file",
            download_url:
              "https://raw.githubusercontent.com/NovaDev404/certificates/main/VIETNAM%20AIRLINES%20JSC%202/password.txt"
          }
        ])
      })
  );
  await page.route(
    /https:\/\/raw\.githubusercontent\.com\/NovaDev404\/certificates\/main\/VIETNAM%20AIRLINES%20JSC%202\/VIETNAM%20AIRLINES%20JSC%202\.p12/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-pkcs12",
        body: Buffer.from("public-p12")
      })
  );
  await page.route(
    /https:\/\/raw\.githubusercontent\.com\/NovaDev404\/certificates\/main\/VIETNAM%20AIRLINES%20JSC%202\/VIETNAM%20AIRLINES%20JSC%202\.mobileprovision/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from("public-profile")
      })
  );
  await page.route(
    /https:\/\/raw\.githubusercontent\.com\/NovaDev404\/certificates\/main\/VIETNAM%20AIRLINES%20JSC%202\/password\.txt/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "nova-password\n"
      })
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Load signed list" }).click();

  await expect(page.getByText("VIETNAM AIRLINES JSC 2", { exact: true })).toBeVisible();
  await expect(page.getByText("China Telecom Corporation Limited")).toHaveCount(0);
  await expect(page.getByText("Aug 8 12:21:46 2026 GMT")).toBeVisible();

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("VIETNAM AIRLINES JSC 2.p12")).toBeVisible();
  await expect(page.getByText("VIETNAM AIRLINES JSC 2.mobileprovision")).toBeVisible();
  await expect(page.locator("#cert-password")).toHaveValue("nova-password");
});

test("opens privacy and legal pages from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("does not intentionally upload")).toBeVisible();

  await page.getByRole("link", { name: "Legal" }).click();
  await expect(page.getByRole("heading", { name: "Legal Notice" })).toBeVisible();
  await expect(page.getByText("made by AntonP29")).toBeVisible();
  await expect(page.getByRole("link", { name: "Visit AntonP29 on GitHub" })).toBeVisible();
});

test("opens previous IPA history from the header", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Previous IPAs" }).click();
  await expect(page.getByRole("heading", { name: "Previous IPAs" })).toBeVisible();
  await expect(page.getByText("No signed IPA history yet.")).toBeVisible();
});

test("retains an active install QR and app icon in previous IPAs", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sylva-signer-ipa-history", JSON.stringify([{
      id: "active-entry",
      name: "SylvaTest_signed.ipa",
      signedAt: new Date().toISOString(),
      metadata: { appName: "Sylva Test", bundleId: "dev.sylva.test", version: "1.0" },
      iconDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      provider: "litterbox",
      uploadExpiry: "1h",
      uploadedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ipaUrl: "https://litter.catbox.moe/example.ipa",
      manifestUrl: "https://api.palera.in/example",
      installUrl: "itms-services://?action=download-manifest&url=https%3A%2F%2Fexample.test"
    }]));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Previous IPAs" }).click();

  await expect(page.getByText("Sylva Test", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Install Sylva Test QR code")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test.describe("mobile availability", () => {
  const iphone = devices["iPhone 13"];
  test.use({
    viewport: iphone.viewport,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
    userAgent: iphone.userAgent
  });

  test("opens the mobile compatibility signer directly", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Desktop recommended" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Mobile compatibility mode", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign IPA" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Legal" })).toBeVisible();
  });

  test("shows direct installation actions instead of QR on iPhone", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("sylva-signer-ipa-history", JSON.stringify([{
        id: "mobile-install-entry",
        name: "SylvaMobile_signed.ipa",
        signedAt: new Date().toISOString(),
        metadata: { appName: "Sylva Mobile", bundleId: "dev.sylva.mobile", version: "1.0" },
        provider: "litterbox",
        uploadExpiry: "1h",
        uploadedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ipaUrl: "https://litter.catbox.moe/mobile.ipa",
        manifestUrl: "https://api.palera.in/mobile",
        installUrl: "itms-services://?action=download-manifest&url=https%3A%2F%2Fexample.test"
      }]));
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Previous IPAs" }).click();

    const installLink = page.getByRole("link", { name: "Install on iPhone" });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute(
      "href",
      "itms-services://?action=download-manifest&url=https%3A%2F%2Fexample.test"
    );
    await expect(page.getByAltText("Install Sylva Mobile QR code")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy iPhone Install Link" })).toHaveCount(0);
  });

  test("scrolls to live signing logs before mobile worker startup", async ({ page }) => {
    const { p12Bytes, profile } = syntheticSigningFiles();
    const ipa = await syntheticIpa();
    await page.goto("/");
    await page.setInputFiles("#ipa", {
      name: "SylvaTest.ipa",
      mimeType: "application/zip",
      buffer: Buffer.from(ipa)
    });
    await page.setInputFiles("#p12", {
      name: "sylva-test.p12",
      mimeType: "application/x-pkcs12",
      buffer: p12Bytes
    });
    await page.setInputFiles("#profiles", {
      name: "sylva-test.mobileprovision",
      mimeType: "application/octet-stream",
      buffer: profile
    });
    await page.locator("#cert-password").fill("sylva-test");

    const signButton = page.getByRole("button", { name: "Sign IPA" });
    await expect(signButton).toBeEnabled();
    await signButton.click();
    await expect(page.getByText("Initializing local WebAssembly signing session")).toBeVisible();
    await expect.poll(async () => {
      const box = await page.getByTestId("signing-console").boundingBox();
      return Boolean(box && box.y >= 0 && box.y < 120);
    }).toBe(true);
  });
});

test("initializes the low-memory OPFS zsign runtime in a worker", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const project = await root.getDirectoryHandle("sylva-zsign", { create: true });
    const work = await project.getDirectoryHandle("work", { create: true });
    await work.getDirectoryHandle(".zsign_cache", { create: true });

    const wasmBase = `${location.origin}/wasm`;
    const source = `
      self.onmessage = async () => {
        const logs = [];
        try {
          const imported = await import('${wasmBase}/zsign-opfs.mjs');
          const module = await imported.default({
            noInitialRun: true,
            locateFile: (file) => '${wasmBase}/' + file,
            print: (...parts) => logs.push(parts.map(String).join(' ')),
            printErr: (...parts) => logs.push(parts.map(String).join(' ')),
          });
          const exitCode = await module.ccall(
            'zsign_run_args',
            'number',
            ['string'],
            ['-a\\x1f/opfs/sylva-zsign/work/missing.ipa'],
            { async: true },
          );
          self.postMessage({ exitCode, logs });
        } catch (error) {
          self.postMessage({ error: error instanceof Error ? error.stack : String(error), logs });
        }
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), {
      type: "module"
    });
    return await new Promise<{ exitCode?: number; logs: string[]; error?: string }>((resolve) => {
      worker.onmessage = (event) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.postMessage(null);
    });
  });

  expect(result.error).toBeUndefined();
  expect(result.exitCode).toBe(-1);
  expect(result.logs.join("\n")).toContain("Invalid path!");
});

test("streams IPA extraction before native zsign archiving", async ({ page }) => {
  await page.goto("/");
  const workerAsset = readdirSync("dist/assets").find((name) => name.startsWith("zsign-worker-"));
  expect(workerAsset).toBeTruthy();
  const ipa = await syntheticIpa();
  const result = await page.evaluate(
    async ({ workerUrl, bytes }) => {
      const worker = new Worker(workerUrl, { type: "module" });
      const file = new File([new Uint8Array(bytes)], "Synthetic.ipa", { type: "application/zip" });
      return new Promise<{
        exitCode?: number;
        logs: string[];
        outputSize?: number;
        outputIsBlob?: boolean;
        outputBytes?: number[];
        progress: string[];
        error?: string;
      }>((resolve) => {
        const logs: string[] = [];
        const progress: string[] = [];
        worker.onmessage = async (event) => {
          const message = event.data;
          if (message.type === "log") logs.push(message.line);
          if (message.type === "progress") progress.push(message.progress.phase);
          if (message.type !== "done") return;
          worker.terminate();
          const output = message.result?.outputs?.[0];
          const outputBytes =
            output?.data instanceof Blob
              ? Array.from(new Uint8Array(await output.data.arrayBuffer()))
              : output?.data instanceof ArrayBuffer
                ? Array.from(new Uint8Array(output.data))
                : undefined;
          resolve({
            exitCode: message.result?.exitCode,
            logs,
            outputSize: output?.data instanceof Blob ? output.data.size : output?.data?.byteLength,
            outputIsBlob: output?.data instanceof Blob,
            outputBytes,
            progress,
            error: message.error
          });
        };
        worker.postMessage({
          id: 1,
          type: "run",
          args: ["-a", "-z", "1", "-o", "/output/Synthetic_signed.ipa", "/blob/input.ipa"],
          files: [{ path: "/blob/input.ipa", file, mode: "workerfs" }],
          options: {
            outputPaths: ["/output/Synthetic_signed.ipa"],
            persistCache: false,
            storageMode: "memory"
          }
        });
      });
    },
    { workerUrl: `/assets/${workerAsset}`, bytes: Array.from(ipa) }
  );

  expect(result.error).toBeUndefined();
  expect(result.exitCode, result.logs.join("\n")).toBe(0);
  expect(result.outputIsBlob).toBe(false);
  expect(result.outputSize).toBeGreaterThan(0);
  expect(result.logs.join("\n")).toContain("Unzip OK!");
  expect(result.logs.join("\n")).toContain("Archive OK!");
  expect(result.progress).toContain("extract");
  expect(result.progress).not.toContain("archive");

  const archive = new ZipReader(new Uint8ArrayReader(new Uint8Array(result.outputBytes!)));
  const entries = await archive.getEntries();
  await archive.close();
  expect(entries[0]).toMatchObject({ filename: "Payload/", directory: true });
  expect(entries.some((entry) => entry.directory)).toBe(true);
  expect(entries.every((entry) => !entry.zip64)).toBe(true);
  expect(entries.every((entry) => entry.msDosCompatible)).toBe(true);
  expect(entries.every((entry) => !entry.filenameUTF8)).toBe(true);
  const firstHeader = new DataView(new Uint8Array(result.outputBytes!).buffer);
  expect(firstHeader.getUint32(0, true)).toBe(0x04034b50);
  expect(firstHeader.getUint16(6, true) & 0x808).toBe(0);
});

test("injects dylibs from writable browser files during fast signing", async ({ page }) => {
  await page.goto("/");
  const workerAsset = readdirSync("dist/assets").find((name) => name.startsWith("zsign-worker-"));
  expect(workerAsset).toBeTruthy();
  const ipa = await syntheticIpa();
  const dylib = readFileSync("vendor/zsign/test/dylib/bin/demo2.dylib");
  const result = await page.evaluate(
    async ({ workerUrl, ipaBytes, dylibBytes }) => {
      const worker = new Worker(workerUrl, { type: "module" });
      const ipaFile = new File([new Uint8Array(ipaBytes)], "Synthetic.ipa", { type: "application/zip" });
      const dylibFile = new File([new Uint8Array(dylibBytes)], "demo2.dylib", {
        type: "application/octet-stream"
      });
      return new Promise<{
        exitCode?: number;
        logs: string[];
        outputBytes?: number[];
        error?: string;
      }>((resolve) => {
        const logs: string[] = [];
        worker.onmessage = async (event) => {
          const message = event.data;
          if (message.type === "log") logs.push(message.line);
          if (message.type !== "done") return;
          worker.terminate();
          const output = message.result?.outputs?.[0];
          const outputBytes =
            output?.data instanceof Blob
              ? Array.from(new Uint8Array(await output.data.arrayBuffer()))
              : output?.data instanceof ArrayBuffer
                ? Array.from(new Uint8Array(output.data))
                : undefined;
          resolve({
            exitCode: message.result?.exitCode,
            logs,
            outputBytes,
            error: message.error
          });
        };
        worker.postMessage({
          id: 1,
          type: "run",
          args: [
            "-a",
            "-l",
            "/work/injections/demo2.dylib",
            "-z",
            "1",
            "-o",
            "/output/Synthetic_injected.ipa",
            "/blob/input.ipa"
          ],
          files: [
            { path: "/blob/input.ipa", file: ipaFile, mode: "workerfs" },
            { path: "/work/injections/demo2.dylib", file: dylibFile, mode: "memfs" }
          ],
          options: {
            outputPaths: ["/output/Synthetic_injected.ipa"],
            persistCache: false,
            storageMode: "memory"
          }
        });
      });
    },
    {
      workerUrl: `/assets/${workerAsset}`,
      ipaBytes: Array.from(ipa),
      dylibBytes: Array.from(dylib)
    }
  );

  expect(result.error).toBeUndefined();
  expect(result.exitCode, result.logs.join("\n")).toBe(0);
  expect(result.logs.join("\n")).toContain("InjectDylib");

  const archive = new ZipReader(new Uint8ArrayReader(new Uint8Array(result.outputBytes!)));
  const entries = await archive.getEntries();
  await archive.close();
  expect(entries.some((entry) => entry.filename === "Payload/SylvaTest.app/demo2.dylib")).toBe(true);
});

test("uses the low-copy native zsign pipeline for mobile compatibility", async ({ page }) => {
  await page.goto("/");
  const ipa = await syntheticIpa();
  const result = await page.evaluate(
    async ({ bytes }) => {
      const worker = new Worker("/mobile-zsign-worker.js?e2e=1");
      const file = new File([new Uint8Array(bytes)], "Synthetic.ipa", { type: "application/zip" });
      return new Promise<{
        exitCode?: number;
        logs: string[];
        outputBytes?: number[];
        outputKind?: string;
        progress: string[];
        error?: string;
      }>((resolve) => {
        const logs: string[] = [];
        const progress: string[] = [];
        worker.onmessage = async (event) => {
          const message = event.data;
          if (message.type === "log") logs.push(message.line);
          if (message.type === "progress") progress.push(message.progress.phase);
          if (message.type !== "done") return;
          worker.terminate();
          const output = message.result?.outputs?.[0];
          const data = output?.data;
          const outputBytes = data instanceof Blob
            ? Array.from(new Uint8Array(await data.arrayBuffer()))
            : data instanceof ArrayBuffer
              ? Array.from(new Uint8Array(data))
              : data instanceof Uint8Array
                ? Array.from(data)
                : undefined;
          resolve({
            exitCode: message.result?.exitCode,
            logs,
            outputBytes,
            outputKind: data?.constructor?.name,
            progress,
            error: message.error
          });
        };
        worker.postMessage({
          id: 2,
          type: "run",
          args: ["-a", "-z", "1", "-o", "/output/Synthetic_mobile_signed.ipa", "/blob/input.ipa"],
          files: [{ path: "/blob/input.ipa", file, mode: "workerfs" }],
          options: {
            outputPaths: ["/output/Synthetic_mobile_signed.ipa"],
            persistCache: false,
            storageMode: "mobile-native"
          }
        });
      });
    },
    { bytes: Array.from(ipa) }
  );

  expect(result.error).toBeUndefined();
  expect(result.exitCode).toBe(0);
  expect(result.outputKind).toBe("Uint8Array");
  expect(result.logs.join("\n")).toContain("Mobile mode: classic worker with native zsign archive pipeline");
  expect(result.logs.join("\n")).toContain("Unzip OK!");
  expect(result.logs.join("\n")).toContain("Archive OK!");
  expect(result.progress).toEqual([]);

  const archive = new ZipReader(new Uint8ArrayReader(new Uint8Array(result.outputBytes!)));
  const entries = await archive.getEntries();
  await archive.close();
  expect(entries.some((entry) => entry.filename === "Payload/")).toBe(true);
  expect(entries.some((entry) => entry.filename.endsWith("Info.plist"))).toBe(true);
});
