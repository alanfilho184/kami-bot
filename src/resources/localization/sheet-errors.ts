/**
 * Os códigos de erro de ficha seguem duas convenções históricas:
 * - validação: o campo entra como prefixo (name-size -> sheet|attribute-name-size);
 * - busca: o próprio código já traz o campo (attribute-not-found -> sheet|attribute-not-found).
 *
 * Centralizar a composição aqui evita chaves duplicadas como
 * "sheet|attribute-attribute-not-found" e "sheet|section-section-not-found".
 */
const CODES_WITH_OWN_FIELD = new Set(['attribute-not-found', 'section-not-found']);

export function sheetErrorKey(field: string, code: string) {
    return CODES_WITH_OWN_FIELD.has(code) ? `sheet|${code}` : `sheet|${field}-${code}`;
}
