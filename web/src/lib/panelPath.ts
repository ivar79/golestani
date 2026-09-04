/**
 * Map the user's roles to the most privileged panel route.
 * Returns null for roles that have no frontend panel yet
 * (support/expert — their backend permissions exist, the panel is a later phase).
 */
export function panelPath(roles: string[] | undefined | null): string | null {
  if (!roles || roles.length === 0) return null;

  // Priority order: admin > designer > business_owner > user.
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("designer")) return "/designer";
  if (roles.includes("business_owner") || roles.includes("user")) return "/dashboard";

  // support / expert: no panel yet.
  return null;
}
