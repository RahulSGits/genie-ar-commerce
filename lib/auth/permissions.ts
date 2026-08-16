/**
 * Role → permission matrix.
 *
 * Authorization is expressed as capabilities, not as role comparisons. A check
 * like `if (role === 'admin' || role === 'owner')` scattered through actions is
 * how a permission model rots: adding a role means auditing every call site,
 * and one missed site is a privilege escalation nobody notices.
 *
 * Every server action asks `can(role, 'products:publish')` instead, so adding
 * "Manager" was a single row in this table.
 */

export const ROLES = ['owner', 'admin', 'manager', 'editor', 'analyst', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  editor: 'Editor',
  analyst: 'Analyst',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full control, including billing and deleting the workspace.',
  admin: 'Everything except billing and workspace deletion.',
  manager: 'Manages the catalogue, campaigns and publishing. No team or billing access.',
  editor: 'Creates and edits products and 3D models. Cannot publish or approve.',
  analyst: 'Reads everything and exports reports. Cannot change anything.',
  viewer: 'Read-only access to the catalogue.',
}

export const PERMISSIONS = [
  'products:read',
  'products:write',
  'products:publish',
  'products:delete',
  'models:write',
  'generation:run',
  'qr:read',
  'qr:write',
  'campaigns:read',
  'campaigns:write',
  'collections:write',
  'analytics:read',
  'analytics:export',
  'brand:write',
  'business:write',
  'team:read',
  'team:manage',
  'billing:read',
  'billing:manage',
  'api:manage',
  'approvals:decide',
  'integrations:manage',
  'support:write',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const READ_ONLY: Permission[] = ['products:read', 'qr:read', 'campaigns:read']

const ANALYST: Permission[] = [...READ_ONLY, 'analytics:read', 'analytics:export', 'billing:read', 'team:read']

const EDITOR: Permission[] = [
  ...READ_ONLY,
  'products:write',
  'models:write',
  'generation:run',
  'qr:write',
  'campaigns:write',
  'collections:write',
  'analytics:read',
  'support:write',
]

const MANAGER: Permission[] = [
  ...EDITOR,
  'products:publish',
  'products:delete',
  'analytics:export',
  'approvals:decide',
  'brand:write',
]

const ADMIN: Permission[] = [
  ...MANAGER,
  'business:write',
  'team:read',
  'team:manage',
  'billing:read',
  'api:manage',
  'integrations:manage',
]

const OWNER: Permission[] = [...ADMIN, 'billing:manage']

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  editor: new Set(EDITOR),
  analyst: new Set(ANALYST),
  viewer: new Set(READ_ONLY),
}

/**
 * Normalises a role read from the database.
 *
 * `member` predates the six-role model and still exists on rows written by
 * earlier versions. It maps to `editor`, which is what it granted at the time —
 * mapping it to `viewer` would silently strip access from existing users, and
 * mapping an unrecognised value to anything but the least privilege would turn
 * a typo into an escalation.
 */
export function normalizeRole(value: string | null | undefined): Role {
  if (value === 'member') return 'editor'
  return (ROLES as readonly string[]).includes(value ?? '') ? (value as Role) : 'viewer'
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  return MATRIX[normalizeRole(role)].has(permission)
}

export function permissionsFor(role: string | null | undefined): Permission[] {
  return [...MATRIX[normalizeRole(role)]]
}

/**
 * Which roles a given role may assign.
 *
 * An admin cannot mint another owner — that is a privilege escalation dressed
 * up as an invite. Only an owner can create an owner.
 */
export function assignableRoles(role: string | null | undefined): Role[] {
  const normalized = normalizeRole(role)
  if (normalized === 'owner') return [...ROLES]
  if (normalized === 'admin') return ROLES.filter((r) => r !== 'owner')
  return []
}
