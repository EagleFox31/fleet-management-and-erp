import type { HelpGuideStep } from "./types";

const HIGHLIGHT_CLASS = "help-spotlight";

export function clearHelpSpotlight() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}

export function highlightHelpTarget(element: Element) {
  clearHelpSpotlight();
  element.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
  }, 2600);
}

export function executeHelpStep(
  step: HelpGuideStep,
  options?: { onBeforeScroll?: () => void },
): boolean {
  options?.onBeforeScroll?.();

  if (step.prepareAction) {
    window.dispatchEvent(
      new CustomEvent("fleet-help-prepare", {
        detail: { action: step.prepareAction },
      }),
    );
  }

  const delay = step.prepareAction ? 380 : 120;

  window.setTimeout(() => {
    const element = document.querySelector(step.target);
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightHelpTarget(element);

    if (element instanceof HTMLElement && typeof element.focus === "function") {
      const focusable =
        element.matches("button, a, input, select, textarea, [tabindex]")
          ? element
          : element.querySelector<HTMLElement>("button, a, input, select, textarea, [tabindex]");
      focusable?.focus({ preventScroll: true });
    }
  }, delay);

  return true;
}
