import { describe, expect, test } from "bun:test";
import { ScopedErrorBoundary } from "./ScopedErrorBoundary";

// No DOM in unit tests: exercise the boundary's lifecycle contract directly.
function boundary(props: Partial<ConstructorParameters<typeof ScopedErrorBoundary>[0]> = {}) {
  const instance = new ScopedErrorBoundary({
    boundary: "route",
    children: "children",
    fallback: () => "fallback",
    ...props,
  });
  instance.setState = (update) => { Object.assign(instance.state, update); };
  return instance;
}

describe("ScopedErrorBoundary", () => {
  test("renders the scoped fallback instead of rethrowing to the root", () => {
    const instance = boundary();
    Object.assign(instance.state, ScopedErrorBoundary.getDerivedStateFromError(new Error("boom")));
    expect(instance.render()).toBe("fallback");
  });

  test("retry clears the error", () => {
    let retry: (() => void) | undefined;
    const instance = boundary({ fallback: next => { retry = next; return "fallback"; } });
    Object.assign(instance.state, ScopedErrorBoundary.getDerivedStateFromError(new Error("boom")));
    instance.render();
    retry?.();
    expect(instance.render()).toBe("children");
  });

  test("a new reset key (navigation) clears the error", () => {
    const state = { error: new Error("boom"), resetKey: "/a" };
    expect(ScopedErrorBoundary.getDerivedStateFromProps({ boundary: "route", children: null, fallback: () => null, resetKey: "/a" }, state)).toBeNull();
    expect(ScopedErrorBoundary.getDerivedStateFromProps({ boundary: "route", children: null, fallback: () => null, resetKey: "/b" }, state))
      .toEqual({ error: null, resetKey: "/b" });
  });

  test("stale-deploy chunk errors propagate only when requested", () => {
    const chunk = new Error("Failed to fetch dynamically imported module: /assets/x.js");
    const propagating = boundary({ propagateChunkErrors: true });
    Object.assign(propagating.state, { error: chunk });
    expect(() => propagating.render()).toThrow(chunk);
    const local = boundary({ boundary: "comments" });
    Object.assign(local.state, { error: chunk });
    expect(local.render()).toBe("fallback");
  });
});
