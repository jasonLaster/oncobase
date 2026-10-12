import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TheaterImage } from "../src/theater-image.tsx";
import { ImageTheater } from "../src/image-theater.tsx";
import { ImageTheaterModal } from "../src/image-theater-modal.tsx";
import "../src/styles.css";

const parameters = new URLSearchParams(location.search);
const mode = parameters.get("mode") ?? "button";
const theme = parameters.get("theme") ?? "light";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.style.colorScheme = theme;
document.body.style.overflow = "auto";

declare global {
  interface Window {
    focusFixture: { remove(): void; replace(): void };
    handoffBeforeCleanup?: string;
  }
}

function Fixture() {
  const [version, setVersion] = useState(0);
  const [present, setPresent] = useState(true);
  window.focusFixture = {
    remove: () => setPresent(false),
    replace: () => setVersion(value => value + 1),
  };
  return (
    <main className="prose">
      <h1>Shared image viewer focus fixture</h1>
      <p>Public synthetic artwork, with both real shared reader opening paths.</p>
      <div style={{ height: 900 }} />
      <section data-trigger-slot>
        {present && (mode === "button" ? (
          <TheaterImage key={version} src="/fixture-light.svg" alt="Focus fixture" width="600" height="400" data-theme-pair />
        ) : (
          <span key={version}>
            <img src="/fixture-light.svg" alt="Focus fixture" width="600" height="400" data-theater-image role="button" tabIndex={0} aria-label="Open image: Focus fixture" data-theme-variant="light" />
            <img src="/fixture-dark.svg" alt="Focus fixture" width="600" height="400" data-theater-image role="button" tabIndex={0} aria-label="Open image: Focus fixture" data-theme-variant="dark" />
          </span>
        ))}
      </section>
      <button type="button" id="after-viewer">Continue reading</button>
      <div style={{ height: 900 }} />
      {mode === "delegated" && <ImageTheater />}
    </main>
  );
}

function HandoffFixture() {
  const [open, setOpen] = useState(false);
  return (
    <main className="prose">
      <button id="handoff-opener" onClick={() => setOpen(true)}>Open handoff</button>
      <button id="after-viewer">Continue reading</button>
      {open && <ImageTheaterModal
        image={{ src: `/fixture-${theme}.svg`, alt: "Handoff image" }}
        onClose={() => {
          document.querySelector("dialog")?.close();
          document.getElementById("after-viewer")?.focus();
          window.handoffBeforeCleanup = document.activeElement?.id;
          setOpen(false);
        }}
      />}
    </main>
  );
}

const fixture = mode === "handoff" ? <HandoffFixture /> : <Fixture />;
createRoot(document.getElementById("root")!).render(
  parameters.get("strict") === "true" ? <StrictMode>{fixture}</StrictMode> : fixture,
);
