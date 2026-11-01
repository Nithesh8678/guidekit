# Spatial guidance reference and implementation

GuideKit's guidance presentation is informed by the official HeyClicky demonstrations inspected on 2026-11-01. This remains a company-configured website SDK with bounded public control context and host-authorized operations.

## Observed reference

The [official FL Studio demonstration](https://www.heyclicky.com/assets/clicky-fl.mp4) shows compact yellow target labels, a nearby triangular guide cursor, rings, a dashed target frame and an arrow. The label sits beside the relevant software control rather than inside a persistent instruction panel. The [official spatial demonstration](https://www.heyclicky.com/assets/clicky-spatial.mp4) similarly places a small colored label at the relevant location. These are published demonstration clips; they do not establish the current application's complete interaction state machine or universal performance.

The installed HeyClicky 1.1.1 build 66 includes separate label, number and explanatory-card drawing primitives. Its packaged resources describe pastel gel labels, local measured text and candidate-based placement. The supplied October 29 handoff also documents retained local drawing and a separate reasoning clock. Those are implementation clues. The current native walkthrough's exact private tooltip implementation, cursor curve and complete timing remain unmeasured. GuideKit's implementation is original browser code, not copied packaged JavaScript.

## GuideKit presentation

The guide uses a compact target-adjacent instruction label, a distinct numbered badge and the requested target mark together. A warm amber palette makes the guide visible on dark hosts while retaining dark readable label text; the company's chat accent remains independent. Pause/Resume, chat and stop occupy a separate compact control strip. Ordinary guidance has no persistent progress bar, wizard footer or generic hint paragraph.

Local presentation follows settled scrolling, cursor arrival and target drawing before the label reveals. Visible Unicode graphemes determine the label's actual width and height. Geometry changes and same-step observations do not replay the instruction. User progress can interrupt the presentation immediately; decorative timing never gates an observed edit or host result. Reduced Motion settles the scene immediately.

Placement uses bounded local geometry, keeps a preferred side where possible, and penalizes overlap with the active target and known nearby public controls. Viewport constraints and native overflow preserve access to long text and controls on short screens. No screenshot capture, page text extraction, model-authored selector or per-frame inference is added.

The complete step remains available to assistive technology through one atomic polite announcement. Explicit skip, pause, chat and stop remain reachable. Existing trusted-event, validity, default-selection, semantic-identity, cancellation, continuation and verified-save rules continue to determine progress. A visually complete annotation is not proof that the website saved an operation.

See [motion and observation](guidance-motion.md), [SDK release boundaries](sdk-release.md) and [the current verification checkpoint](status.md).
