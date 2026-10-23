export const ROLES = ['owner', 'manager', 'attendant', 'kitchen', 'courier'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'orders.view',
  'orders.prepare', // aceitar, em preparo, pronto
  'orders.deliver', // saiu para entrega, concluído
  'orders.cancel',
  'payments.confirm',
  'menu.manage',
  'menu.availability', // pausar/retomar itens esgotados
  'reports.view',
  'cash.manage',
  'settings.manage',
  'team.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  manager: ALL,
  attendant: ['orders.view', 'orders.prepare', 'orders.deliver', 'orders.cancel', 'payments.confirm', 'cash.manage', 'menu.availability'],
  kitchen: ['orders.view', 'orders.prepare', 'menu.availability'],
  courier: ['orders.view', 'orders.deliver'],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  attendant: 'Atendente',
  kitchen: 'Cozinha',
  courier: 'Entregador',
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** Gerentes não podem criar/alterar proprietários; somente o proprietário pode. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true;
  if (actor === 'manager') return target !== 'owner';
  return false;
}
