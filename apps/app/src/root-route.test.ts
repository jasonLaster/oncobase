import { describe, expect, test } from "bun:test";
import { rootRouteFor } from "./root-route";

describe("rootRouteFor", () => {
  test("only reader routes start session verification", () => {
    expect(rootRouteFor("/", false)).toBe("reader");
    expect(rootRouteFor("/wiki/some/page", false)).toBe("reader");
    expect(rootRouteFor("/search", true)).toBe("reader");
    expect(rootRouteFor("/login", false)).toBe("login");
    expect(rootRouteFor("/sign-in", false)).toBe("sign-in");
    expect(rootRouteFor("/terms-and-conditions", false)).toBe("terms");
    expect(rootRouteFor("/education", false)).toBe("education");
    expect(rootRouteFor("/education/topic", false)).toBe("education");
    expect(rootRouteFor("/tools/pathology-viewer", false)).toBe("pathology");
    expect(rootRouteFor("/tools/dicom-viewer", false)).toBe("dicom");
    expect(rootRouteFor("/tools/dicom-compare", false)).toBe("dicom");
  });

  test("an education-only response sends other wiki routes to the password gate", () => {
    expect(rootRouteFor("/wiki/private", true)).toBe("password");
    expect(rootRouteFor("/wiki/education/topic", true)).toBe("reader");
    expect(rootRouteFor("/login", true)).toBe("login");
    expect(rootRouteFor("/sign-in", true)).toBe("sign-in");
  });
});
