import { useEffect } from "react";
import { ArrowRight, Check, GitBranch, Minus, Scale, X } from "lucide-react";
import { compareRouteMetadata } from "../special-route-metadata";
import { updateClientRouteMetadata } from "../document-title";
import { OncobaseBrand } from "./LandingBrands";
import { PublicHeader } from "./PublicChrome";
import {
  COMPARE_ASOF,
  alsoWorthKnowing,
  compareDisclosure,
  compareHeroLede,
  compareSources,
  cellFor,
  goals,
  matrix,
  matrixOrder,
  notSure,
  oncobasePieces,
  otherOpenSource,
  productName,
  products,
  type Cell,
  type Piece,
  type ProductId,
} from "./compare-data";
import { REPO_URL } from "./features-data";
import "./landing.css";
import "./features.css";
import "./compare.css";

const nav = [
  ["choose", "Which one?"],
  ["table", "Side by side"],
  ["options", "Each option"],
  ["build", "Build your own"],
  ["sources", "Sources"],
] as const;

const external = { rel: "noopener noreferrer", target: "_blank" } as const;

function productLink(id: ProductId) {
  return products.find((product) => product.id === id)?.url ?? REPO_URL;
}

/** A product's name as a link to its own site. Oncobase is "us", so it is marked rather than linked out. */
function ProductChip({ id, lead }: { id: ProductId; lead?: boolean }) {
  return (
    <a className="cp-chip" data-us={id === "oncobase" || undefined} data-lead={lead || undefined} href={productLink(id)} {...external}>
      {productName(id)}
    </a>
  );
}

function CellView({ cell }: { cell: Cell }) {
  const Icon = cell.tone === "yes" ? Check : cell.tone === "no" ? X : cell.tone === "unknown" ? Minus : null;
  return (
    <span className="cp-cell" data-tone={cell.tone}>
      {Icon ? <Icon aria-hidden="true" size={15} /> : <span aria-hidden="true" className="cp-cell-gap" />}
      <span>{cell.t}</span>
    </span>
  );
}

function Hero() {
  return (
    <section className="ft-hero lp-container" aria-labelledby="compare-title">
      <p className="ft-kicker">
        <Scale size={15} aria-hidden="true" /> An honest comparison
      </p>
      <h1 id="compare-title">
        How <span>Oncobase</span> compares.
      </h1>
      <p className="ft-hero-lede">{compareHeroLede}</p>
      <p className="cp-not-sure">{notSure}</p>
      <div className="ft-hero-actions">
        <a className="lp-button" href="#choose">
          Which should I use? <ArrowRight size={16} />
        </a>
        <a className="lp-text-link" href="#build">
          I’m building my own <ArrowRight size={15} />
        </a>
      </div>
      <p className="cp-disclosure">{compareDisclosure}</p>
    </section>
  );
}

function Choose() {
  return (
    <section className="ft-group lp-container" id="choose" aria-labelledby="choose-title">
      <div className="lp-section-heading">
        <h2 id="choose-title">Which should I use?</h2>
        <p>Pick what you’re trying to do. For most of these, something simpler than Oncobase is the right start.</p>
      </div>
      <ul className="cp-goals">
        {goals.map((goal) => (
          <li className="cp-goal" key={goal.id}>
            <h3>{goal.label}</h3>
            <div>
              <p className="cp-pick">
                <span>Start with</span> <ProductChip id={goal.pick} lead />
                {goal.also.length ? (
                  <span className="cp-also">
                    Also consider{" "}
                    {goal.also.map((id, index) => (
                      <span key={id}>
                        {index ? ", " : ""}
                        <a href={productLink(id)} {...external}>
                          {productName(id)}
                        </a>
                      </span>
                    ))}
                  </span>
                ) : null}
              </p>
              <p>{goal.why}</p>
              <p className="cp-move">{goal.moveOn}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Matrix() {
  return (
    <section className="ft-group lp-container" id="table" aria-labelledby="table-title">
      <div className="lp-section-heading">
        <h2 id="table-title">Side by side</h2>
        <p>
          The questions that decide it. A dash means the product’s own site or repository doesn’t say, which isn’t the
          same as no.
        </p>
      </div>
      <div className="ft-table-wrap cp-matrix" role="region" aria-label="Comparison table, scrolls sideways" tabIndex={0}>
        <table className="ft-table">
          <caption className="ft-sr-only">How Oncobase compares with other tools</caption>
          <thead>
            <tr>
              <th scope="col">Question</th>
              {matrixOrder.map((id) => (
                <th data-us={id === "oncobase" || undefined} key={id} scope="col">
                  {productName(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {matrixOrder.map((id) => (
                  <td data-us={id === "oncobase" || undefined} key={id}>
                    <CellView cell={cellFor(row, id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ft-caption">As of {COMPARE_ASOF}. Pricing and features change; check each product before you decide.</p>
    </section>
  );
}

function Options() {
  return (
    <section className="ft-group lp-container" id="options" aria-labelledby="options-title">
      <div className="lp-section-heading">
        <h2 id="options-title">Each option</h2>
        <p>What each one is great at, and what to keep in mind. Open one to read more.</p>
      </div>
      <div className="ft-acc-list">
        {products.map((product) => (
          <details className="ft-acc cp-prod" key={product.id}>
            <summary>
              <span className="ft-acc-title">
                <strong>{product.name}</strong>
                <span>{product.tagline}</span>
              </span>
              <span className="ft-acc-preview">{product.kind}</span>
            </summary>
            <div className="cp-prod-body">
              <p>
                <b>Great at</b>
                {product.great}
              </p>
              <p>
                <b>Keep in mind</b>
                {product.consider}
              </p>
              <a className="lp-text-link" href={product.url} {...external}>
                {product.id === "oncobase" ? "View the code" : `Visit ${product.name}`} <ArrowRight size={15} />
              </a>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function PieceTable({ caption, pieces }: { caption: string; pieces: Piece[] }) {
  return (
    <div className="ft-table-wrap">
      <table className="ft-table cp-pieces">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Piece</th>
            <th scope="col">License</th>
            <th scope="col">What you get</th>
          </tr>
        </thead>
        <tbody>
          {pieces.map((piece) => (
            <tr key={piece.name}>
              <td>
                <a href={piece.url} {...external}>
                  {piece.name}
                </a>
              </td>
              <td>{piece.license}</td>
              <td>{piece.gives}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Build() {
  return (
    <section className="ft-group lp-container" id="build" aria-labelledby="build-title">
      <div className="lp-section-heading">
        <h2 id="build-title">Building your own? Start from what exists.</h2>
        <p>
          Whether it’s for your family or a company, you don’t have to start from nothing. Oncobase is MIT licensed, so
          you can use it as it is or take the parts you need, and a few other open-source projects cover the rest.
        </p>
      </div>
      <div className="cp-build-cards">
        <article>
          <h3>For your family</h3>
          <p>
            Have your agent set it up. Point it at <a href="/features.md">/features.md</a>, which lists every feature
            and interface, and at the CLI that checks and publishes a vault.
          </p>
          <a className="lp-text-link" href="/features#build">
            How to build with Oncobase <ArrowRight size={15} />
          </a>
        </article>
        <article>
          <h3>For a company</h3>
          <p>
            Fork the code, reuse the pieces below, and pair it with a clinical data layer like Medplum. Oncobase carries
            no compliance certification. If you handle other people’s health information, check which rules apply to
            you.
          </p>
          <a className="lp-text-link" href={REPO_URL} {...external}>
            <GitBranch size={15} /> View the code <ArrowRight size={15} />
          </a>
        </article>
      </div>
      <PieceTable caption="Reusable code in Oncobase. Only the CLI is on npm; the rest lives under packages/ in the repository." pieces={oncobasePieces} />
      <PieceTable caption="Other open-source projects worth building on" pieces={otherOpenSource} />
      <h3 className="cp-also-title">Also worth knowing</h3>
      <ul className="cp-also-list">
        {alsoWorthKnowing.map((item) => (
          <li key={item.name}>
            <a href={item.url} {...external}>
              {item.name}
            </a>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Sources() {
  return (
    <section className="ft-group lp-container" id="sources" aria-labelledby="sources-title">
      <div className="lp-section-heading">
        <h2 id="sources-title">Sources and corrections</h2>
        <p>
          Checked {COMPARE_ASOF} against each product’s own site or repository. If something here is wrong or out of
          date, <a href={`${REPO_URL}/issues`} {...external}>open an issue</a> and we’ll fix it.
        </p>
      </div>
      <ul className="cp-sources">
        {compareSources.map((source) => (
          <li key={source.url}>
            <a href={source.url} {...external}>
              {source.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cta() {
  return (
    <section className="ft-cta" aria-labelledby="cta-title">
      <div className="lp-container">
        <h2 id="cta-title">See what Oncobase does.</h2>
        <p>If it sounds like what you need, the features page shows every part of it, and the code is free.</p>
        <div className="ft-hero-actions">
          <a className="lp-button" href="/features">
            Everything Oncobase can do <ArrowRight size={16} />
          </a>
          <a className="lp-text-link" href={REPO_URL} {...external}>
            <GitBranch size={15} /> View the code <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer-shell">
      <div className="ft-footer lp-container">
        <div className="ft-footer-row">
          <a className="lp-brand" href="/features" aria-label="Oncobase features">
            <OncobaseBrand />
          </a>
          <nav aria-label="Footer">
            <a href={REPO_URL} {...external}>
              GitHub
            </a>
            <a href="/features">Features</a>
            <a href="/compare.md">For agents</a>
            <a href="/terms-and-conditions">Terms</a>
          </nav>
        </div>
        <p className="ft-footer-credit">
          Not medical, legal, or financial advice. Product details as of {COMPARE_ASOF}. Inspired by{" "}
          <a href="https://osteosarc.com/" {...external}>
            osteosarc.com
          </a>
          .
        </p>
      </div>
    </footer>
  );
}

export function ComparePage() {
  useEffect(() => {
    updateClientRouteMetadata(compareRouteMetadata());
  }, []);

  return (
    <div className="landing-page ft-page" data-test-id="compare-page">
      <div className="ft-root">
        <a className="lp-skip-link" href="#compare-main">
          Skip to content
        </a>
        <PublicHeader brandHref="/features" brandLabel="Oncobase features" items={nav} navLabel="Comparison sections" />
        <main id="compare-main">
          <Hero />
          <Choose />
          <Matrix />
          <Options />
          <Build />
          <Sources />
          <Cta />
        </main>
        <Footer />
      </div>
    </div>
  );
}
