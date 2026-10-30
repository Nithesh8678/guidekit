import { useState, type MouseEvent } from "react";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Layers3,
  Menu,
  MousePointer2,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Brand } from "./shared";
import { LandingDemo } from "./LandingDemo";
import "./platform-fonts.css";
import "./landing.css";

interface Props {
  signedIn: boolean;
  onSignUp(): void;
  onSignIn(): void;
  onDashboard(): void;
}

const questions = [
  {
    question: "What can my users do with GuideKit?",
    answer:
      "They can ask a question, follow visual steps inside your interface, and request the actions your application supports. The guide keeps the original goal as relevant pages and controls change, and waits for your application to verify saved results.",
  },
  {
    question: "How does it learn about my company?",
    answer:
      "Add text or Markdown product documentation, help articles and instructions to your workspace. Publish a knowledge version for your agent. Answers use that published company knowledge alongside the public controls your product makes available; this does not require fine-tuning a model.",
  },
  {
    question: "Can people talk to the guide?",
    answer:
      "Yes. Browser voice is available in compatible browsers, including desktop Chrome and Edge, with microphone permission. People can also type. Voice is optional, and browser support and narration quality can vary.",
  },
  {
    question: "Can I connect it to any interface?",
    answer:
      "The SDK supports website interfaces with accessible HTML controls. Developers can explicitly mark public controls and supply safe application context. Custom canvas interfaces, native applications and cross-origin frames need a dedicated adapter. Your application still controls permissions and approved actions.",
  },
  {
    question: "Where is my workspace stored?",
    answer:
      "This edition runs on your local GuideKit instance. Accounts, agent configuration and published knowledge belong to that instance. Inference uses its configured provider. Public hosting is a separate deployment step; creating a workspace does not deploy your product or enable paid model calls.",
  },
];

export function Landing({ signedIn, onSignUp, onSignIn, onDashboard }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [playRequest, setPlayRequest] = useState(0);
  const start = signedIn ? onDashboard : onSignUp;
  const startHref = signedIn ? "#dashboard" : "#signup";
  const navigate = (
    event: MouseEvent<HTMLAnchorElement>,
    action: () => void,
  ) => {
    // Keep native new-tab and modified-click behavior on real destination links.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    setMenuOpen(false);
    action();
  };
  function preview() {
    setPlayRequest((value) => value + 1);
    document.getElementById("guidekit-preview")?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
  }
  return (
    <div className="gk-landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-header-inner">
          <a className="landing-brand" href="#" aria-label="GuideKit home">
            <Brand />
          </a>
          <nav className="landing-desktop-nav" aria-label="Main navigation">
            <a href="#product">Product</a>
            <a href="#workflow">How it works</a>
            <a href="#developers">For developers</a>
          </nav>
          <div className="landing-header-actions">
            {!signedIn && (
              <a
                className="landing-signin"
                href="#login"
                onClick={(event) => navigate(event, onSignIn)}
              >
                Sign in
              </a>
            )}
            <a
              className="landing-button landing-button-small"
              href={startHref}
              onClick={(event) => navigate(event, start)}
            >
              {signedIn ? "Open dashboard" : "Get started"}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
            <button
              className="landing-menu-toggle"
              type="button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-nav"
              onClick={() => setMenuOpen((value) => !value)}
            >
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            className="landing-mobile-nav"
            id="landing-mobile-nav"
            aria-label="Mobile navigation"
          >
            <a href="#product" onClick={() => setMenuOpen(false)}>
              Product
            </a>
            <a href="#workflow" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#developers" onClick={() => setMenuOpen(false)}>
              For developers
            </a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>
              Questions & answers
            </a>
            {!signedIn && (
              <a href="#login" onClick={(event) => navigate(event, onSignIn)}>
                Sign in
              </a>
            )}
          </nav>
        )}
      </header>
      <main id="landing-main">
        <section
          className="landing-hero landing-wrap"
          aria-labelledby="landing-title"
        >
          <div className="landing-hero-copy">
            <p className="landing-intro">
              <span>
                <MousePointer2 size={14} aria-hidden="true" />
              </span>{" "}
              A helpful layer for your product
            </p>
            <h1 id="landing-title">
              <span>Your product.</span>
              <span>A guide that</span>
              <span>knows the way.</span>
            </h1>
            <p className="landing-hero-description">
              Turn your company knowledge into an AI guide that explains, points
              to the next step, and helps people get things done.
            </p>
            <div className="landing-hero-actions">
              <a
                className="landing-button"
                href={startHref}
                onClick={(event) => navigate(event, start)}
              >
                {signedIn ? "Open dashboard" : "Build your guide"}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <button
                className="landing-preview-link"
                type="button"
                onClick={preview}
              >
                <span>
                  <Play size={12} fill="currentColor" aria-hidden="true" />
                </span>
                See it in action
              </button>
            </div>
            <p className="landing-hero-note">
              Your knowledge. Your brand. Right inside your website.
            </p>
          </div>
          <div className="landing-hero-product" id="guidekit-preview">
            <LandingDemo playRequest={playRequest} />
          </div>
        </section>
        <div
          className="landing-promise-strip landing-wrap"
          aria-label="Platform capabilities"
        >
          <p>
            <BookOpen size={19} aria-hidden="true" />
            <span>Answers from your knowledge</span>
          </p>
          <p>
            <MousePointer2 size={19} aria-hidden="true" />
            <span>Guidance on the actual interface</span>
          </p>
          <p>
            <ShieldCheck size={19} aria-hidden="true" />
            <span>Actions with your approval</span>
          </p>
        </div>

        <section
          className="landing-product"
          id="product"
          aria-labelledby="product-title"
        >
          <div className="landing-wrap">
            <div className="landing-section-heading">
              <h2 id="product-title">
                Help that moves
                <br />
                with your users.
              </h2>
              <p>
                A question is just the beginning. Give people a clear path
                through your product, all the way to the next useful outcome.
              </p>
            </div>
            <div className="landing-product-grid">
              <figure className="landing-knowledge-art">
                <img
                  src="/assets/knowledge-guide.webp"
                  width="1254"
                  height="1254"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>
                  <BookOpen size={19} aria-hidden="true" />
                  <span>
                    <strong>Your knowledge, put to work.</strong>
                    <small>Product docs, help articles and instructions</small>
                  </span>
                </figcaption>
              </figure>
              <div className="landing-features">
                <article>
                  <span className="landing-feature-icon">
                    <BookOpen size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>Knows what makes you, you.</h3>
                    <p>
                      Build from your own product knowledge. Shape the answers,
                      appearance and boundaries in one developer workspace.
                    </p>
                  </div>
                </article>
                <article>
                  <span className="landing-feature-icon">
                    <MousePointer2 size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>Shows the way, step by step.</h3>
                    <p>
                      Point to the right control, keep up as tools change, and
                      continue the same task across supported pages.
                    </p>
                  </div>
                </article>
                <article>
                  <span className="landing-feature-icon">
                    <AudioLines size={22} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>A conversation that goes somewhere.</h3>
                    <p>
                      Let people type or use browser voice. Make the next step
                      visible, and keep them in control of actions and
                      approvals.
                    </p>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing-workflow landing-wrap"
          id="workflow"
          aria-labelledby="workflow-title"
        >
          <div className="landing-section-heading">
            <h2 id="workflow-title">
              Your product knowledge.
              <br />
              Their next step.
            </h2>
            <p>
              Everything you need to create, configure and connect a guide that
              feels like part of your product.
            </p>
          </div>
          <div className="landing-workflow-grid">
            <figure className="landing-path-art">
              <img
                src="/assets/guide-path.webp"
                width="1536"
                height="1024"
                loading="lazy"
                decoding="async"
                alt="A blue guide ribbon finding a path through three translucent windows"
              />
              <figcaption>
                <span className="landing-path-dot" />A clear path from question
                to action.
              </figcaption>
            </figure>
            <ol className="landing-steps">
              <li>
                <span className="landing-step-number">1</span>
                <div>
                  <h3>Make it yours.</h3>
                  <p>
                    Add your docs and instructions. Choose your guide’s name,
                    greeting, look and allowed actions.
                  </p>
                </div>
              </li>
              <li>
                <span className="landing-step-number">2</span>
                <div>
                  <h3>Connect your product.</h3>
                  <p>
                    Publish a knowledge version, then add the shared SDK with
                    your agent ID and configured endpoint.
                  </p>
                </div>
              </li>
              <li>
                <span className="landing-step-number">3</span>
                <div>
                  <h3>Help people move forward.</h3>
                  <p>
                    Answer in context, guide through the interface, and wait for
                    your application to confirm the result.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section
          className="landing-developers"
          id="developers"
          aria-labelledby="developers-title"
        >
          <div className="landing-developer-grid landing-wrap">
            <div className="landing-developer-copy">
              <span className="landing-developer-icon">
                <Code2 size={25} aria-hidden="true" />
              </span>
              <h2 id="developers-title">
                One SDK.
                <br />A guide that’s yours.
              </h2>
              <p>
                Build the experience in your workspace. Connect it to the
                product you already have, with your own knowledge and
                permissions.
              </p>
              <ul>
                <li>
                  <Check size={17} aria-hidden="true" />
                  Script and ESM bundles with TypeScript types
                </li>
                <li>
                  <Check size={17} aria-hidden="true" />
                  Company-scoped, published knowledge
                </li>
                <li>
                  <Check size={17} aria-hidden="true" />
                  Actions validated by your application
                </li>
              </ul>
              <a
                className="landing-text-link"
                href={startHref}
                onClick={(event) => navigate(event, start)}
              >
                {signedIn ? "Open your workspace" : "Create your workspace"}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <div className="landing-code-panel">
              <div className="landing-code-header">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                <p>inside-your-product.ts</p>
                <Code2 size={16} aria-hidden="true" />
              </div>
              <pre aria-label="Illustrative GuideKit SDK configuration">
                <code>
                  <span className="code-comment">
                    // Your product. Your published agent.
                  </span>
                  {"\n"}
                  <span className="code-keyword">const</span> guide = GuideKit.
                  <span className="code-function">mount</span>({"{"}
                  {"\n"} agentId:{" "}
                  <span className="code-string">'YOUR_AGENT_ID'</span>,{"\n"}{" "}
                  endpoint:{" "}
                  <span className="code-string">'YOUR_GUIDEKIT_ORIGIN'</span>,
                  {"\n"} targetMode:{" "}
                  <span className="code-string">'explicit'</span>,{"\n"}
                  {"}"});{"\n\n"}
                  <span className="code-keyword">await</span> guide.ready;
                </code>
              </pre>
              <div className="landing-code-foot">
                <Layers3 size={16} aria-hidden="true" />
                <p>
                  Your workspace generates the complete, pinned install snippet.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing-faq landing-wrap"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div>
            <p className="landing-section-note">A little more clarity</p>
            <h2 id="faq-title">
              Good questions.
              <br />
              Clear answers.
            </h2>
            <p>
              Get to know the guide before
              <br className="landing-desktop-break" /> you make it yours.
            </p>
          </div>
          <div className="landing-faq-list">
            {questions.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <ChevronDown size={19} aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="landing-last-call landing-wrap"
          aria-labelledby="last-call-title"
        >
          <div className="landing-cta-box">
            <div>
              <Sparkles size={27} aria-hidden="true" />
              <h2 id="last-call-title">
                Give every user
                <br />a clear next step.
              </h2>
              <p>Build a guide that feels at home in your product.</p>
            </div>
            <a
              className="landing-button landing-button-white"
              href={startHref}
              onClick={(event) => navigate(event, start)}
            >
              {signedIn ? "Open dashboard" : "Build your guide"}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className="landing-footer landing-wrap">
        <div className="landing-footer-top">
          <a className="landing-brand" href="#" aria-label="GuideKit home">
            <Brand />
          </a>
          <p>A helpful guide, right inside your product.</p>
          <nav aria-label="Footer navigation">
            <a href="#product">Product</a>
            <a href="#developers">Developers</a>
            <a href="#faq">FAQ</a>
            {!signedIn && (
              <a href="#login" onClick={(event) => navigate(event, onSignIn)}>
                Sign in
              </a>
            )}
          </nav>
        </div>
        <div className="landing-footer-bottom">
          <p>© 2026 GuideKit</p>
          <p>Local workspace edition</p>
        </div>
      </footer>
    </div>
  );
}
