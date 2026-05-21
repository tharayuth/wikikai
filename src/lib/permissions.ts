import type { User } from "../store/users.js";
import type { PermissionStore, AccessLevel } from "../store/permissions.js";

export type { AccessLevel };

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface AssertOptions {
  /** When false, the check no-ops (kill switch). Defaults to true. */
  enabled?: boolean;
}

/**
 * Throw `ForbiddenError` if `user` cannot access `project` at `need`
 * level. Admins always pass. Missing user, missing row, and view-only
 * user attempting edit all throw.
 */
export function assertProjectAccess(
  user: User | null,
  project: string,
  need: AccessLevel,
  perms: PermissionStore,
  opts: AssertOptions = {},
): void {
  if (opts.enabled === false) return;
  if (!user) throw new ForbiddenError("auth required");
  if (user.is_admin) return;
  if (!project) throw new ForbiddenError("project is required");
  const row = perms.get(user.id, project);
  if (!row) throw new ForbiddenError(`no access to project '${project}'`);
  if (need === "edit" && row.level !== "edit") {
    throw new ForbiddenError(`edit not allowed on project '${project}'`);
  }
}
