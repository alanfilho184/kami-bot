import config from '../../configs/config';
import { Section_Type } from '../../types/enums';

/** URL canônica da ficha no site, com `id` para desambiguar nomes duplicados. */
export function buildSheetSiteUrl(sheet: Sheet): string {
    return `${config.KAMI_SITE_URL}/${sheet.user_id}/ficha/${encodeURIComponent(sheet.sheet_name)}?id=${sheet.id}`;
}

export function getSiteUrl(): string {
    return config.KAMI_SITE_URL;
}

/** Seções com semântica própria que o bot não edita. */
export function isSpecialSection(section: Sheet_Section): boolean {
    return Number(section.type) !== Section_Type.STANDARD;
}

/** Mantém o layout alinhado quando o bot renomeia/apaga seções e atributos. */
export function renameLayoutSection(sheet: Sheet, oldName: string, newName: string): void {
    const sections = sheet.sheet_layout?.sections;

    if (!sections?.[oldName]) {
        return;
    }

    sections[newName] = sections[oldName];
    delete sections[oldName];
}

export function removeLayoutSection(sheet: Sheet, sectionName: string): void {
    if (sheet.sheet_layout?.sections) {
        delete sheet.sheet_layout.sections[sectionName];
    }
}

export function renameLayoutAttribute(sheet: Sheet, sectionName: string, oldName: string, newName: string): void {
    const section = sheet.sheet_layout?.sections?.[sectionName];

    if (!section) {
        return;
    }

    if (section.attributes?.[oldName]) {
        section.attributes[newName] = section.attributes[oldName];
        delete section.attributes[oldName];
    }

    if (section.header) {
        for (const role of ['title', 'subtitle', 'image'] as const) {
            if (section.header[role] === oldName) {
                section.header[role] = newName;
            }
        }
    }

    if (Array.isArray(section.full)) {
        section.full = [...new Set(section.full.map(name => (name === oldName ? newName : name)))];
    }
}

export function removeLayoutAttribute(sheet: Sheet, sectionName: string, attributeName: string): void {
    const section = sheet.sheet_layout?.sections?.[sectionName];

    if (!section) {
        return;
    }

    if (section.attributes) {
        delete section.attributes[attributeName];
    }

    if (section.header) {
        for (const role of ['title', 'subtitle', 'image'] as const) {
            if (section.header[role] === attributeName) {
                delete section.header[role];
            }
        }
    }

    if (Array.isArray(section.full)) {
        section.full = section.full.filter(name => name !== attributeName);
    }
}
