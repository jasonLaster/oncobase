import { expect, test } from "bun:test";
import { PRIVATE_PREFIX_ROLES, accessiblePrefixes, canAccessKey, ruleForKey, validatePrefixRules } from "./prefix-roles";

test("the initial policy", () => {
  expect(PRIVATE_PREFIX_ROLES.map(rule => [rule.prefix, [...rule.roles].sort()])).toEqual([
    ["private/slides/ucsf-svs/", ["Admin", "Patient"]],
    ["private/slides/ucsf-svs-deid/", ["Admin", "Patient"]],
    ["private/curefirst/", ["Admin", "Patient"]],
    ["private/companies/serova/", ["Patient", "Serova"]],
  ]);
});

test("roles open only their prefixes", () => {
  const cases: [string, string[], boolean][] = [
    ["private/slides/ucsf-svs/a.svs", ["Patient"], true],
    ["private/slides/ucsf-svs/a.svs", ["admin"], true],
    ["private/slides/ucsf-svs/a.svs", ["Serova"], false],
    ["private/slides/ucsf-svs/a.svs", ["PHM"], false],
    ["private/slides/ucsf-svs-deid/a.svs", ["Admin"], true],
    ["private/curefirst/a.pdf", ["Admin"], true],
    ["private/curefirst/a.pdf", ["jacob"], false],
    ["private/companies/serova/deck.pdf", ["serova"], true],
    ["private/companies/serova/deck.pdf", ["Patient"], true],
    ["private/companies/serova/deck.pdf", ["Admin"], false],
    ["private/companies/serova/deck.pdf", [], false],
    ["public/a.csv", [], true],
  ];
  for (const [key, roles, allowed] of cases) expect({ key, roles, allowed: canAccessKey(key, roles) }).toEqual({ key, roles, allowed });
});

test("default deny: unmapped keys and near-miss prefixes", () => {
  const everyone = ["Patient", "Admin", "PHM", "Serova", "jacob"];
  for (const key of [
    "private/curefirstX/a", "private/curefirst", "private/curefirst/", "private/slides/ucsf-svsX/a",
    "private/slides/ucsf-svs", "private/other/a", "private/a", "privatex/curefirst/a",
    "staging/a", "runs/a", "modal/a", "public", "public/", "publicx/a", "manifest.json", "",
  ]) {
    expect({ key, allowed: canAccessKey(key, everyone) }).toEqual({ key, allowed: false });
  }
  // ucsf-svs/ does not swallow ucsf-svs-deid/ (prefixes end in "/").
  expect(ruleForKey("private/slides/ucsf-svs-deid/a")?.prefix).toBe("private/slides/ucsf-svs-deid/");
});

test("the longest prefix decides", () => {
  const rules = validatePrefixRules([
    { prefix: "private/a/", roles: ["Patient", "Admin"], note: "" },
    { prefix: "private/a/phi/", roles: ["Patient"], note: "" },
  ]);
  expect(canAccessKey("private/a/x", ["Admin"], rules)).toBe(true);
  expect(canAccessKey("private/a/phi/x", ["Admin"], rules)).toBe(false);
  expect(canAccessKey("private/a/phi/x", ["Patient"], rules)).toBe(true);
});

test("listing prefixes follow the viewer's roles", () => {
  expect(accessiblePrefixes([])).toEqual([]);
  expect(accessiblePrefixes(["serova"])).toEqual(["private/companies/serova/"]);
  expect(accessiblePrefixes(["Admin"])).toEqual(["private/slides/ucsf-svs/", "private/slides/ucsf-svs-deid/", "private/curefirst/"]);
  expect(accessiblePrefixes(["patient"])).toHaveLength(4);
});

test("rules that could widen access are refused", () => {
  for (const prefix of ["private/", "public/x/", "private/x", "private/../x/", "private//x/", "staging/", "private/a\\b/", "private/%2e/"]) {
    expect(() => validatePrefixRules([{ prefix, roles: ["Admin"], note: "" }])).toThrow();
  }
  expect(() => validatePrefixRules([{ prefix: "private/x/", roles: [], note: "" }])).toThrow();
  expect(() => validatePrefixRules([{ prefix: "private/x/", roles: ["A"], note: "" }, { prefix: "private/x/", roles: ["B"], note: "" }])).toThrow();
});
