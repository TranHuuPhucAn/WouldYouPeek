import Link from "next/link";
import { getCurrentAccount } from "@/server/auth/guards";

export default async function HomePage() {
  const viewer = await getCurrentAccount();
  return (
    <div className="landing-shell">
      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="coral-line" /> ADVANCED VALORANT DECISION
              PRACTICE
            </p>
            <h1>
              One moment.
              <br />
              Three choices.
              <br />
              <span className="accent-text">Your call.</span>
            </h1>
            <p className="hero-description">
              Step into a pro’s point of view.
              <br className="desktop-break" /> Make the next move yourself.
            </p>
            <p className="hero-support">
              Watch real gameplay, decide at the pause, then see what the player
              did. Start with three TenZ moments on Bind, or explore published
              creator scenarios.
            </p>
            <div className="hero-actions">
              <Link
                href="/library"
                className="button button-primary button-large"
              >
                Browse scenarios <span aria-hidden="true">↗</span>
              </Link>
              <Link
                href={viewer ? "/history" : "/sign-in?returnTo=%2Flibrary"}
                className="text-button"
              >
                {viewer ? "View saved sessions →" : "Sign in to play →"}
              </Link>
            </div>
            <p className="demo-disclosure">
              <span className="small-diamond" aria-hidden="true" /> Ranked POV
              footage with AI-authored analysis. Several choices can be
              defensible.
            </p>
          </div>
          <div className="hero-visual">
            <div className="visual-topline">
              <span className="mono">START WITH TENZ</span>
              <span className="tag-outline">TENZ · CLOVE · BIND</span>
            </div>
            <div className="vod-session-preview">
              <div className="preview-session-heading">
                <span className="eyebrow">THREE SCENARIOS. ONE POV.</span>
                <p>
                  Read the round.
                  <br />
                  <strong>Choose your timing.</strong>
                </p>
              </div>
              <ol className="vod-scenario-list">
                <li>
                  <span className="mono">01</span>
                  <div>
                    <h2>Utility before the next fight</h2>
                    <p>Round 11 · Attack · Utility timing</p>
                  </div>
                </li>
                <li>
                  <span className="mono">02</span>
                  <div>
                    <h2>Contest the smoke at 35 HP</h2>
                    <p>Round 13 · Defense · Risk and support</p>
                  </div>
                </li>
                <li>
                  <span className="mono">03</span>
                  <div>
                    <h2>Reassess the advantage</h2>
                    <p>Same round · Linked follow-up</p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="visual-bottom">
              <div>
                <span className="eyebrow">AFTER YOUR CALL</span>
                <h2>Compare. Then question.</h2>
              </div>
              <span className="preview-arrow" aria-hidden="true">
                ↗
              </span>
            </div>
            <div className="preview-options" aria-hidden="true">
              <span>
                01 <strong>Watch</strong>
              </span>
              <span>
                02 <strong>Decide</strong>
              </span>
              <span>
                03 <strong>Review</strong>
              </span>
            </div>
          </div>
        </section>
        <section className="how-it-works" aria-label="How it works">
          <div className="how-header">
            <span className="eyebrow">A THREE-STEP DEBRIEF</span>
            <span className="quiet-note">
              A good call deserves a good explanation.
            </span>
          </div>
          <div className="how-grid">
            <article>
              <span className="step-number">01</span>
              <div>
                <h2>Watch the POV.</h2>
                <p>
                  Read the player’s information before the video pauses at the
                  decision.
                </p>
              </div>
            </article>
            <article>
              <span className="step-number">02</span>
              <div>
                <h2>Make your call.</h2>
                <p>Commit to an action before seeing how it plays out.</p>
              </div>
            </article>
            <article>
              <span className="step-number">03</span>
              <div>
                <h2>Review the alternatives.</h2>
                <p>
                  Watch the pro’s action, then explore AI analysis and the
                  conditions that make other choices work.
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>MAKE THE CALL. THEN LEARN WHY.</span>
        <span>
          Would You Peek? <span className="footer-dot">·</span> POV prototype
        </span>
      </footer>
    </div>
  );
}
