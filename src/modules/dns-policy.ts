/**
 * A troca automática de DNS só roda em produção.
 * O CLI manual (npm run dns:*) não passa por esta política e continua disponível.
 */
export function isAutomaticDnsEnabled(nodeEnv: string | undefined): boolean {
    return nodeEnv === 'production';
}
