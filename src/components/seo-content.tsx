const signingSteps = [
  ['Choose an IPA', 'Select a local .ipa file or import an IPA from a direct URL.'],
  ['Add your certificate', 'Choose a .p12 or .pfx signing certificate and enter its password.'],
  ['Add provisioning', 'Choose one or more .mobileprovision files that cover the app and device.'],
  ['Review signing options', 'Optionally change the bundle ID or inject compatible .dylib files.'],
  ['Sign and download', 'Start local signing, keep the tab open, then download the signed IPA.'],
] as const

const faqItems = [
  {
    question: 'Does Sylva upload my certificate or IPA?',
    answer:
      'No. Normal signing runs locally in a browser worker, so the IPA, certificate, provisioning profile, password, dylibs, and signed output stay on this device. Only the optional installation flow uploads the already-signed IPA after you confirm it.',
  },
  {
    question: 'What is a P12 signing certificate?',
    answer:
      'A .p12 or .pfx file packages an Apple signing certificate with its private key. Sylva uses it locally with a provisioning profile to create a code signature for an iOS app.',
  },
  {
    question: 'Do I need Xcode or a Mac to sign an IPA?',
    answer:
      'No. Sylva runs zsign as WebAssembly in the browser, so signing does not require Xcode, macOS, or a remote signing server.',
  },
  {
    question: 'Which browsers work with Sylva Signer?',
    answer:
      'A current Chrome or Edge browser on desktop is recommended. Safari, iPhone, iPad, Android, and other mobile browsers use an experimental compatibility path and may be slower or more memory constrained.',
  },
  {
    question: 'What is the IPA size limit?',
    answer:
      "Local signing has no fixed Sylva file-size limit, but it is constrained by the browser and the device's available memory. The optional temporary installation upload rejects signed IPA files larger than 1 GB.",
  },
  {
    question: 'What happens if a signing certificate is revoked?',
    answer:
      'Apple may stop trusting apps signed with a revoked certificate. Those apps can stop opening or installing even when the original signing process completed successfully.',
  },
] as const

export function PrivacySummary() {
  return (
    <section aria-labelledby="local-signing-title" className="mb-7 max-w-3xl">
      <p className="text-xs font-medium uppercase text-muted-foreground">Private by design</p>
      <h2 id="local-signing-title" className="mt-2 text-xl font-semibold md:text-2xl">
        Sign iOS IPA files locally in your browser
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
        Sylva Signer runs zsign as WebAssembly inside a dedicated browser worker. Your IPA,
        certificate, provisioning profile, password, optional dylibs, and signed output remain on
        this device during signing. Temporary installation uploads only the signed IPA after you
        explicitly confirm it.
      </p>
    </section>
  )
}

export function SigningGuideAndFaq() {
  return (
    <div className="mt-12 space-y-12">
      <section aria-labelledby="signing-guide-title" id="how-to-sign">
        <h2 id="signing-guide-title" className="text-xl font-semibold md:text-2xl">
          How do you sign an iOS IPA file online?
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          Sylva signs an iOS app package locally without Xcode or macOS. Supply the IPA, an Apple
          signing certificate, and a matching provisioning profile; review the detected app details;
          then run the WebAssembly signer and download the finished file without sending signing
          credentials to a server.
        </p>
        <ol className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
          {signingSteps.map(([title, description], index) => (
            <li key={title} className="flex gap-3 border-t border-border pt-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="faq-title" id="faq">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Version 0.1.0
          </p>
          <h2 id="faq-title" className="mt-2 text-xl font-semibold md:text-2xl">
            Frequently asked questions
          </h2>
        </div>
        <div className="mt-5 divide-y divide-border border-y border-border">
          {faqItems.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="cursor-pointer list-none pr-8 text-sm font-semibold marker:hidden">
                {item.question}
              </summary>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
