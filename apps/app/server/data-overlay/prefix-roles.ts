// Which diana-tnbc.com roles may read which private S3 prefixes on
// data.diana-tnbc.com. This file is the whole policy: review changes to it
// like an access grant.
//
// - Role names are the site's existing roles (admin "Access" page, vault
//   skill grant-site-access): Patient, Admin, PHM, Serova, jacob. They are
//   matched case-insensitively, the same way isAdminSessionUser reads
//   "admin". The site owner counts as Admin.
// - Every prefix starts with `private/` and ends with `/`, so
//   `private/curefirst/` never matches `private/curefirstX/...`.
// - The longest matching prefix decides, so a narrower entry can restrict
//   part of a broader one.
// - DEFAULT DENY: a key outside `public/` with no matching entry (for
//   example `staging/`, `runs/`, `modal/` or an unlisted `private/` path) is
//   readable by nobody through the overlay.

export type PrefixRoleRule = {
  prefix: string;
  roles: readonly string[];
  note: string;
};

export const PUBLIC_PREFIX = "public/";
export const PRIVATE_PREFIX = "private/";

export const PRIVATE_PREFIX_ROLES: readonly PrefixRoleRule[] = [
  { prefix: "private/slides/ucsf-svs/", roles: ["Patient", "Admin"], note: "UCSF whole-slide images, originals (contain PHI)" },
  { prefix: "private/slides/ucsf-svs-deid/", roles: ["Patient", "Admin"], note: "UCSF whole-slide images, de-identified" },
  { prefix: "private/curefirst/", roles: ["Admin", "Patient"], note: "Cure First materials" },
  // Mirrors the wiki's Serova board access: the Serova role and Patient; Admin
  // and PHM are path-excluded from Serova bundles on the wiki, so not here.
  { prefix: "private/companies/serova/", roles: ["Serova", "Patient"], note: "Serova board bundle" },
];

const SEGMENT_FORBIDDEN = /[\u0000-\u001f\u007f\\%]/;

/** Throws when a rule could widen access by accident. Run at module load. */
export function validatePrefixRules(rules: readonly PrefixRoleRule[]) {
  const seen = new Set<string>();
  for (const rule of rules) {
    const { prefix } = rule;
    if (!prefix.startsWith(PRIVATE_PREFIX) || !prefix.endsWith("/") || prefix === PRIVATE_PREFIX) {
      throw new Error(`Data overlay prefix must be a directory under private/: ${prefix}`);
    }
    const segments = prefix.slice(0, -1).split("/");
    if (segments.some(segment => !segment || segment === "." || segment === ".." || SEGMENT_FORBIDDEN.test(segment))) {
      throw new Error(`Data overlay prefix has an invalid segment: ${prefix}`);
    }
    if (seen.has(prefix)) throw new Error(`Duplicate data overlay prefix: ${prefix}`);
    seen.add(prefix);
    if (rule.roles.length === 0 || rule.roles.some(role => !role.trim())) {
      throw new Error(`Data overlay prefix needs at least one named role: ${prefix}`);
    }
  }
  return rules;
}

validatePrefixRules(PRIVATE_PREFIX_ROLES);

function normalizedRoles(roles: Iterable<string>) {
  return new Set([...roles].map(role => role.trim().toLowerCase()).filter(Boolean));
}

/** The rule that governs a non-public key: the longest matching prefix. */
export function ruleForKey(key: string, rules: readonly PrefixRoleRule[] = PRIVATE_PREFIX_ROLES) {
  let match: PrefixRoleRule | null = null;
  for (const rule of rules) {
    if (key.length > rule.prefix.length && key.startsWith(rule.prefix) && (!match || rule.prefix.length > match.prefix.length)) {
      match = rule;
    }
  }
  return match;
}

function ruleAllows(rule: PrefixRoleRule, roles: Set<string>) {
  return rule.roles.some(role => roles.has(role.trim().toLowerCase()));
}

/** Whether a viewer holding `viewerRoles` may read `key`. Public keys are
 * open; any other key needs a matching rule and a shared role. */
export function canAccessKey(key: string, viewerRoles: Iterable<string>, rules: readonly PrefixRoleRule[] = PRIVATE_PREFIX_ROLES) {
  if (key.startsWith(PUBLIC_PREFIX) && key.length > PUBLIC_PREFIX.length) return true;
  const rule = ruleForKey(key, rules);
  return rule !== null && ruleAllows(rule, normalizedRoles(viewerRoles));
}

/** Prefixes worth listing for this viewer. Listed keys are still filtered
 * through canAccessKey, so a narrower deny inside a prefix holds. */
export function accessiblePrefixes(viewerRoles: Iterable<string>, rules: readonly PrefixRoleRule[] = PRIVATE_PREFIX_ROLES) {
  const roles = normalizedRoles(viewerRoles);
  return rules.filter(rule => ruleAllows(rule, roles)).map(rule => rule.prefix);
}
