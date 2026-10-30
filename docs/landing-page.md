# GuideKit platform landing

The public entry page presents GuideKit as the platform. Company applications remain integrations. Root stays public for signed-in and anonymous visitors; real account entry uses `#signup` and `#login`, and authenticated work uses `#dashboard`. Recovery, verification and invitation hashes retain their existing token handling. Creating a workspace uses the real server API and does not enable paid inference or public hosting.

## Design

Palette: Porcelain `#fbfcff`, Ink `#172b45`, Cornflower `#4a66ef`, Blue mist `#edf2ff`, Slate `#566781`, and Outline `#e3e8f1`. Sora carries large geometric headings; Instrument Sans handles reading and controls. Both fonts are pinned Fontsource 5.3.0 packages and served locally; their SIL Open Font License notices are shipped under `public/assets/fonts/`.

The selected layout pairs a concise left-aligned headline with an actual interactive preview. This gives the product behavior priority over a full-bleed decorative hero. Generated illustrations support the knowledge and setup sections and the account page. Feature rows, a genuine three-step setup sequence, a developer example, FAQ and a single blue final call to action keep the rest of the page quiet.

```text
Logo     Product / How it works / Developers       Sign in / Get started
Headline + account CTA          Interactive product preview
                  Three concrete capabilities
Knowledge illustration          Product benefits
Path illustration               Setup sequence
Developer explanation           Illustrative SDK configuration
FAQ                             Native disclosure controls
                  Create a guide
```

The preview is explicitly synthetic, component-contained and requires no microphone or model request. Visitors can actually perform Contacts → New contact → enter a name → Save, then replay or end it. It is an explanation of the product experience, not a claim that a live model answered the preview question. Company-scoped knowledge, real SDK capabilities and approved host operations are described without fake customers, adoption numbers, testimonials, pricing or universal app compatibility.

## Generated assets

Created with the built-in image generation tool, then encoded as WebP for local website delivery. The full generated originals remain in the tool's default generated-images folder. No generated text or screenshot is used as a functioning interface.

- `apps/dashboard/public/assets/guide-path.webp`: 1536 × 1024, approximately 35 KB; used for setup and account entry.
- `apps/dashboard/public/assets/knowledge-guide.webp`: 1254 × 1254, approximately 48 KB; used for company knowledge.
- Both retain their generated composition. Conversion changes the delivery format, not the content. Images have explicit dimensions and offscreen landing illustrations load lazily.

### Guide path prompt

```text
Use case: stylized-concept.
Asset type: original brand illustration for GuideKit, a platform for helpful visual AI guides embedded inside software.
Primary request: a refined studio-quality 3D sculpture of a continuous cobalt-blue ribbon that gently threads its way through three floating rounded rectangular window frames, finishing in an elegant directional arrow tip. The physical metaphor is a helpful guide finding a clear path through a product.
Scene: an airy almost-white ice-blue studio, no horizon line, soft ambient shadows. Frosted translucent glass frames with porcelain-white edges; the ribbon is rich cornflower/cobalt blue, satin material with subtle highlights. Sophisticated editorial product-render craft, believable materials and ray-traced soft light. Sparse, calm composition, carefully spaced objects and plenty of breathing room.
Composition: landscape 3:2, central sculpture fills approximately 65 percent, enough clean margin for cropping within a website section or auth panel. Gentle three-quarter view, all forms readable, no large hard dark shadows.
Palette: white, pale blue #edf2ff, navy shadows and blue #4a66ef.
Text: none.
Avoid: text, letters, logos, watermarks, robots, people, stars, particles, gradients used as graphic decoration, floating unrelated shapes, clutter, neon, dark background. This is a polished original sculptural illustration, not a screenshot or wireframe.
```

### Knowledge prompt

```text
Use case: stylized-concept.
Asset type: companion brand illustration for GuideKit's company-knowledge feature.
Primary request: a refined 3D studio still life showing a small tidy stack of translucent blue and porcelain-white document sheets becoming a single clear blue directional guide ribbon. One sheet floats just above the stack; a small cobalt satin ribbon curves naturally between the sheets and resolves into one crisp arrowhead. A visual metaphor for product knowledge becoming helpful guidance.
Style: the same restrained luxury editorial product-render aesthetic as an almost-white ice-blue studio, frosted glass and soft matte porcelain, physically believable materials and nuanced soft shadows. Sparse composition, deliberate silhouette, exquisite clean edges.
Composition: nearly square, compact centered sculpture with ample almost-white negative space. Slightly elevated three-quarter view. No interface controls or drawn text. Restrained volume, no busy explosion of papers.
Palette: pale blue #edf2ff, white, cobalt/cornflower blue #4a66ef, cool navy shadows.
Text: none.
Avoid: letters, labels, logos, watermarks, robots, people, stars, particles, neon glow, dark background, fake diagrams or interface screenshots, unrelated floating ornaments.
```

## Acceptance

Run `npm run check`, `npm run test:e2e`, `npm run test:dashboard` and `npm run test:dashboard:integration`. The account-entry tests use disposable real API/database state; contract and preview tests explicitly intercept API behavior. Desktop/mobile screenshots, keyboard/reduced-motion checks and accessibility scans accompany the integrated landing review. No personal media, account credentials or live inference is needed for this frontend acceptance.


Verified locally on 2026-10-30: 190 unit/HTTP/runtime/graph/SDK checks, 50 core browser cases, 27 dashboard/landing contracts and three real API/database integrations passed. Eleven focused landing cases include keyboard, reduced-motion, mobile layouts, no preview runtime calls, and unsuppressed axe WCAG 2/2.1/2.2 AA plus best-practice checks. No violations were returned on the landing page, signup or active preview forms. Automated checks do not establish a complete accessibility certification. Final ignored screenshot evidence is under `.data/evidence/landing-*.png`.
