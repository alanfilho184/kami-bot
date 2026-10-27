/**
 * Ordem fixa de prioridade do failover:
 *
 * - primary   (VPS A): sempre ativo, não roda take-over;
 * - secondary (VPS B): observa o primary;
 * - backup    (local): observa primary e secondary, só assume se os dois caírem.
 */
export const FAILOVER_ORDER = ['primary', 'secondary', 'backup'] as const;

export type InstanceRole = (typeof FAILOVER_ORDER)[number];

export function isInstanceRole(value: unknown): value is InstanceRole {
    return typeof value === 'string' && (FAILOVER_ORDER as readonly string[]).includes(value);
}

/**
 * Papéis com prioridade maior que o papel informado, do maior para o menor.
 * Ex.: backup -> [primary, secondary].
 */
export function higherPriorityRoles(role: InstanceRole): InstanceRole[] {
    const index = FAILOVER_ORDER.indexOf(role);
    return index <= 0 ? [] : FAILOVER_ORDER.slice(0, index);
}

/**
 * Primeiro papel online na ordem de prioridade, ou null se nenhum peer
 * de maior prioridade estiver disponível.
 */
export function pickHandbackTarget(
    role: InstanceRole,
    onlineRoles: Iterable<InstanceRole>
): InstanceRole | null {
    const online = new Set(onlineRoles);
    return higherPriorityRoles(role).find(candidate => online.has(candidate)) ?? null;
}
