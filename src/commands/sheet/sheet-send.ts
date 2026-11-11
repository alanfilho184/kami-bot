import { EmbedBuilder, ButtonBuilder, ActionRowBuilder } from '@discordjs/builders';
import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import config from '../../configs/config';
import { ButtonStyle, Routes } from 'discord-api-types/v10';
import { Attribute_Type, Command_Category, Section_Type } from '../../types/enums';
import sheetNameCache from '../../resources/cache/sheet-name.cache';
import { similaritySearch } from '../../resources/utils/string-similarity';
import SheetController from '../../controllers/sheet.controller';
import rest from '../../configs/rest';
import logger from '../../configs/logger';
import { buildSheetSiteUrl, getSiteUrl } from '../../resources/utils/sheet-site';
import { deactivateIrtSheets, pruneDeadIrtSheets } from '../../resources/utils/irt';

/**
 * A ficha não cabe nos limites do Discord (embeds, fields ou caracteres).
 * O chamador deve avisar o usuário e, se houver IRT, desativá-lo em vez de
 * tentar enviar um payload que o Discord vai recusar.
 */
export class SheetTooComplexError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'SheetTooComplexError';
    }
}

function toTextAttribute(attribute: { name: string; value: string; type: number; position: number }) {
    let name = `${attribute.name}`;
    let value = `${attribute.value}`;
    let type = Number(attribute.type);
    let position = Number(attribute.position);

    if (type === Attribute_Type.TEXT) {
        if (name.length > 256) {
            return `name|overflow|${position}`;
        } else if (value.length > 1024) {
            return `value|overflow|${position}`;
        }

        return {
            name: name,
            value: value,
            inline: !(value.length > 32)
        };
    } else {
        return false;
    }
}

function toNumberAttribute(attribute: { name: string; value: string; type: number; position: number }) {
    let name = `${attribute.name}`;
    let stringValue = `${attribute.value ?? ''}`;
    let value = Number(attribute.value);
    let type = Number(attribute.type);
    let position = Number(attribute.position);

    if (type === Attribute_Type.NUMBER) {
        if (name.length > 256) {
            return `name|overflow|${position}`;
        } else if (stringValue.length > MAX_FIELD_LENGTH) {
            return `value|overflow|${position}`;
        } else if (!Number.isFinite(value)) {
            return `value|invalid|${position}`;
        }

        return {
            name: name,
            value: stringValue,
            inline: true
        };
    } else {
        return false;
    }
}

function toImageAttribute(attribute: { name: string; value: string; type: number; position: number }) {
    let name = `${attribute.name}`;
    let value = `${attribute.value}`;
    let type = Number(attribute.type);
    let position = Number(attribute.position);

    if (type === Attribute_Type.IMAGE) {
        if (value === 'image') {
            return {
                thumbnail: {
                    url: `${value}`
                }
            };
        } else {
            if (name.length > 256) {
                return `name|overflow|${position}`;
            }

            return {
                name: name,
                value: value,
                inline: true
            };
        }
    } else {
        return false;
    }
}

function toListAttribute(attribute: Attribute) {
    let name = `${attribute.name}`;
    let value = attribute.value as unknown as { items: { name: string; quantity: string | number }[] };
    let type = Number(attribute.type);
    let position = Number(attribute.position);

    if (type === Attribute_Type.LIST) {
        if (name.length > 256) {
            return `name|overflow|${position}`;
        }

        let listValue = '';

        const items = Array.isArray(value?.items) ? value.items : [];

        for (let item of items) {
            listValue += `${item.name} ×${item.quantity}\n`;
        }

        listValue = listValue.trimEnd();

        // O Discord rejeita field com value vazio. Uma lista vazia ainda é
        // informação válida da ficha, então mostramos um traço.
        if (listValue.length === 0) {
            listValue = '—';
        }

        if (listValue.length > 1024) {
            return `value|overflow|${position}`;
        }

        return {
            name: name,
            value: listValue,
            inline: true
        };
    } else {
        return false;
    }
}

function toBarAttribute(attribute: Attribute) {
    let name = `${attribute.name}`;
    const rawValue = attribute.value as unknown as
        { max?: number; min?: number; step?: number; actual?: number } | null | undefined;
    let type = Number(attribute.type);
    let position = Number(attribute.position);

    if (type === Attribute_Type.BAR) {
        if (name.length > 256) {
            return `name|overflow|${position}`;
        }

        const actual = Number(rawValue?.actual ?? 0);
        const max = Number(rawValue?.max ?? 0);
        let barValue = `${Number.isFinite(actual) ? actual : 0} / ${Number.isFinite(max) ? max : 0}`;

        if (barValue.length > 1024) {
            return `value|overflow|${position}`;
        }

        return {
            name: name,
            value: barValue,
            inline: true
        };
    } else {
        return false;
    }
}

const MAX_EMBEDS = 10;
const MAX_FIELD_LENGTH = 1024;
const MAX_FIELDS_PER_EMBED = 25;
const MAX_EMBED_TITLE_LENGTH = 256;
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const MAX_EMBED_AUTHOR_LENGTH = 256;
const MAX_EMBED_FOOTER_LENGTH = 2048;
const MAX_EMBED_TOTAL_LENGTH = 6000;

function assertSheetEmbedLimits(embeds: EmbedBuilder[]): void {
    if (embeds.length > MAX_EMBEDS) {
        throw new SheetTooComplexError(`Sheet has ${embeds.length} embeds; Discord allows ${MAX_EMBEDS}`);
    }

    let totalLength = 0;

    for (const embed of embeds) {
        const data = embed.toJSON();
        const fields = data.fields ?? [];
        const title = data.title ?? '';
        const description = data.description ?? '';
        const authorName = data.author?.name ?? '';
        const footerText = data.footer?.text ?? '';

        if (fields.length > MAX_FIELDS_PER_EMBED) {
            throw new SheetTooComplexError(`Embed has ${fields.length} fields; Discord allows ${MAX_FIELDS_PER_EMBED}`);
        }

        if (title.length > MAX_EMBED_TITLE_LENGTH) {
            throw new SheetTooComplexError(`Embed title has ${title.length} characters`);
        }

        if (description.length > MAX_EMBED_DESCRIPTION_LENGTH) {
            throw new SheetTooComplexError(`Embed description has ${description.length} characters`);
        }

        if (authorName.length > MAX_EMBED_AUTHOR_LENGTH) {
            throw new SheetTooComplexError(`Embed author has ${authorName.length} characters`);
        }

        if (footerText.length > MAX_EMBED_FOOTER_LENGTH) {
            throw new SheetTooComplexError(`Embed footer has ${footerText.length} characters`);
        }

        totalLength += title.length + description.length + authorName.length + footerText.length;

        for (const field of fields) {
            const name = field.name ?? '';
            const value = field.value ?? '';

            if (name.length < 1 || name.length > MAX_EMBED_TITLE_LENGTH) {
                throw new SheetTooComplexError(`Embed field name has ${name.length} characters`);
            }

            if (value.length < 1 || value.length > MAX_FIELD_LENGTH) {
                throw new SheetTooComplexError(`Embed field value has ${value.length} characters`);
            }

            totalLength += name.length + value.length;
        }
    }

    if (totalLength > MAX_EMBED_TOTAL_LENGTH) {
        throw new SheetTooComplexError(
            `Sheet has ${totalLength} embed characters; Discord allows ${MAX_EMBED_TOTAL_LENGTH}`
        );
    }
}

function toTextValue(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
}

/**
 * O Discord recusa o embed inteiro quando a URL da imagem é inválida. Como o
 * thumbnail é só um extra do render (a ficha completa fica no site), valores
 * que não são http(s) são ignorados em vez de derrubar a sincronização.
 */
function safeImageUrl(value: unknown): string | null {
    const text = toTextValue(value).trim();

    if (!text) {
        return null;
    }

    try {
        const url = new URL(text);

        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function truncateLines(lines: string[], maxLength: number): { text: string; count: number; truncated: boolean } {
    let text = '';
    let count = 0;

    for (const line of lines) {
        const next = text.length > 0 ? `${text}\n${line}` : line;

        if (next.length > maxLength) {
            if (text.length === 0) {
                text = `${line.slice(0, Math.max(0, maxLength - 1))}…`;
                count = 1;
            }

            return { text, count, truncated: true };
        }

        text = next;
        count += 1;
    }

    return { text, count, truncated: false };
}

function getHeaderInfo(
    sheet: Sheet,
    section: Sheet_Section
): { title: Attribute | null; subtitle: Attribute | null; image: Attribute | null } | null {
    if (Number(section.type) !== Section_Type.HEADER) {
        return null;
    }

    const entry = sheet.sheet_layout?.sections?.[section.name]?.header;

    if (!entry) {
        return null;
    }

    const attributes = Array.isArray(section.attributes) ? section.attributes : [];
    const byName = new Map(attributes.map(attribute => [attribute.name, attribute]));
    const title = entry.title ? byName.get(entry.title) : undefined;
    const subtitle = entry.subtitle ? byName.get(entry.subtitle) : undefined;
    const image = entry.image ? byName.get(entry.image) : undefined;
    const resolved = {
        title: Number(title?.type) === Attribute_Type.TEXT ? (title ?? null) : null,
        subtitle: Number(subtitle?.type) === Attribute_Type.TEXT ? (subtitle ?? null) : null,
        image: Number(image?.type) === Attribute_Type.IMAGE ? (image ?? null) : null
    };

    if (!resolved.title && !resolved.subtitle && !resolved.image) {
        return null;
    }

    return resolved;
}

export function getSheetSiteUrl(sheet: Sheet): string | null {
    if (sheet.user?.has_site_account !== true) {
        return null;
    }

    return buildSheetSiteUrl(sheet);
}

/**
 * Mensagem usada quando a ficha não cabe no Discord. Prefere a URL da ficha
 * no site; se o dono não tiver conta no site, aponta para a home do Kami.
 */
export function buildSheetTooComplexContent(sheet: Sheet, language: Available_Languages): string {
    const url = getSheetSiteUrl(sheet) ?? getSiteUrl();

    return localization(language, 'sheet-send|too-complex', [{ replace: '$url$', value: url }]);
}

function toStatusAttribute(
    attribute: Attribute,
    language: Available_Languages
): { field: { name: string; value: string; inline: boolean }; truncated: boolean } | null {
    const value = attribute.value as Sheet_Status_Value;
    const items = Array.isArray(value?.items) ? value.items : [];

    if (items.length === 0) {
        return null;
    }

    const lines = items.map(item => {
        const state = localization(language, item.active ? 'sheet-send|status-active' : 'sheet-send|status-inactive');
        const name = toTextValue(item.name).replace(/\r?\n/g, ' ');

        return `${item.active ? '●' : '○'} ${name} (${state})`;
    });
    const result = truncateLines(lines, MAX_FIELD_LENGTH);

    return {
        field: {
            name: attribute.name,
            value: result.text,
            inline: false
        },
        truncated: result.truncated
    };
}

function toTableAttribute(attribute: Attribute): {
    field: { name: string; value: string; inline: boolean };
    truncated: boolean;
} | null {
    const value = attribute.value as Sheet_Table_Value;
    const columns = Array.isArray(value?.columns) ? value.columns.map(column => toTextValue(column)) : [];
    const rows = Array.isArray(value?.rows) ? value.rows : [];

    if (columns.length === 0) {
        return null;
    }

    const sanitize = (cell: unknown): string => toTextValue(cell).replace(/\r?\n/g, ' ').replace(/```/g, '` ` `');

    const lines = ['```', columns.map(sanitize).join(' | ')];
    let truncated = false;

    for (const row of rows) {
        const line = columns.map((_, index) => sanitize(Array.isArray(row) ? row[index] : '')).join(' | ');

        if ([...lines, line, '```'].join('\n').length > MAX_FIELD_LENGTH) {
            truncated = true;
            break;
        }

        lines.push(line);
    }

    lines.push('```');
    const result = truncateLines(lines, MAX_FIELD_LENGTH);

    return {
        field: {
            name: attribute.name,
            value: result.text,
            inline: false
        },
        truncated: truncated || result.truncated
    };
}

function toGalleryAttribute(
    section: Sheet_Section,
    language: Available_Languages
): {
    thumbnail: string;
    field: { name: string; value: string; inline: boolean };
    extra: number;
} | null {
    const images = section.attributes
        .filter(attribute => Number(attribute.type) === Attribute_Type.IMAGE)
        .map(attribute => ({ attribute, url: safeImageUrl(attribute.value) }))
        .filter((image): image is { attribute: Attribute; url: string } => image.url !== null);

    if (images.length === 0) {
        return null;
    }

    const lines = images.map((image, index) => {
        const label = image.attribute.name || `Imagem ${index + 1}`;
        return `[${label}](${image.url})`;
    });
    const result = truncateLines(lines, MAX_FIELD_LENGTH);

    return {
        thumbnail: images[0].url,
        field: {
            name: localization(language, 'sheet-send|gallery-title'),
            value: result.text,
            inline: false
        },
        extra: images.length - result.count
    };
}

function buildLimitedField(
    features: string[],
    language: Available_Languages,
    siteUrl: string | null
): { name: string; value: string; inline: boolean } | null {
    const unique = [...new Set(features.filter(Boolean))];

    if (unique.length === 0) {
        return null;
    }

    const link = siteUrl ?? getSiteUrl();
    const linkLabel = localization(language, 'sheet-send|site-open');
    const header = localization(language, 'sheet-send|limited-description', [
        { replace: '$url$', value: `[${linkLabel}](${link})` }
    ]);
    const value = truncateLines([header, ...unique], MAX_FIELD_LENGTH).text;

    return {
        name: localization(language, 'sheet-send|limited-title'),
        value,
        inline: false
    };
}

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'ficha_enviar',
        'en-us': 'sheet_send'
    },
    fullNames: {
        'pt-br': 'Enviar Ficha',
        'en-us': 'Sheet Send'
    },
    descriptions: {
        'pt-br': 'Envia uma ficha já criada em forma de embed.',
        'en-us': "Sends a sheet already as a Discord's embed"
    },
    arguments: {
        'pt-br': [
            {
                name: 'nome_da_ficha',
                description: 'Nome da ficha que deseja enviar.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'opções',
                description: 'Opções para a mensagem que a ficha será enviada.',
                type: 'STRING',
                required: false,
                choices: [
                    {
                        name: 'Manter mensagem sincronizada com a ficha',
                        return: 'sync'
                    }
                ]
            }
        ],
        'en-us': [
            {
                name: 'sheet_name',
                description: 'The name of the sheet you want to send.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'options',
                description: 'Options for the message that the sheet will be sent.',
                type: 'STRING',
                required: false,
                choices: [
                    {
                        name: 'Keep message synchronized with the sheet',
                        return: 'sync'
                    }
                ]
            }
        ]
    },
    type: 1,
    category: Command_Category.SHEET_SEND,
    doNotAcknowledge: true,
    run: async (int: Interaction, language: Available_Languages) => {
        const sheetName = int.getArgs().get('sheet_name').value;
        const syncRequested = int.getArgs().get('options')?.value === 'sync';
        const keepSync = syncRequested && int.hasGuildInstall();

        if (keepSync) {
            await int.acknowledge();
        } else {
            await int.acknowledge(int.kami_user?.secret_send);
        }

        const sheet = await SheetController.getByUserIdAndSheetName(int.kami_user?.id!, sheetName);

        if (!sheet) {
            return int.reply({
                content: localization(language, 'sheet-send|sheet-not-found', [
                    { replace: '$sheet$', value: sheetName }
                ])
            });
        }

        sheet.user = int.kami_user!;

        let embeds: EmbedBuilder[];

        try {
            embeds = createSheetEmbed(sheet, language);
        } catch (err) {
            if (err instanceof SheetTooComplexError) {
                const content = buildSheetTooComplexContent(sheet, language);

                // Se a ficha já tinha mensagens sincronizadas, elas não podem
                // continuar apontando para uma ficha que não cabe no Discord.
                try {
                    const irtSheets = (await SheetController.getIrtSheetBySheetId(sheet.id)) ?? [];

                    if (irtSheets.length > 0) {
                        await deactivateIrtSheets(irtSheets, { content });
                    }
                } catch (deactivateError) {
                    logger.error(deactivateError, {
                        event: 'sheet.send.too_complex_deactivate_failed',
                        sheet_id: sheet.id
                    });
                }

                return int.reply({ content });
            }

            throw err;
        }

        if (keepSync) {
            const irtLimit = int.kami_user?.is_premium ? null : 3;
            let irtSheetCount = await SheetController.countIrtSheetBySheetId(sheet.id);

            if (irtLimit !== null && irtSheetCount >= irtLimit) {
                // Mensagens apagadas manualmente deixam links "zumbis" que
                // ocupam o limite para sempre. Antes de recusar, confere se
                // as mensagens ainda existem.
                await pruneDeadIrtSheets(sheet.id);
                irtSheetCount = await SheetController.countIrtSheetBySheetId(sheet.id);

                if (irtSheetCount >= irtLimit) {
                    return int.reply({
                        content: localization(language, 'sheet-send|irt-limit-reached')
                    });
                }
            }

            const msg = (await int.reply({
                embeds: embeds
            })) as { id: string; channel_id?: string; webhook_id: string };
            const channelId = msg.channel_id ?? int.channel_id;

            const createResult = await SheetController.createIrtSheetWithLimit(
                int.kami_user?.id!,
                sheet.id,
                msg.id,
                channelId,
                irtLimit
            );

            if (createResult === 'limit') {
                await rest
                    .patch(Routes.channelMessage(channelId, msg.id), {
                        body: {
                            content: localization(language, 'sheet-send|irt-limit-reached'),
                            embeds: [],
                            components: []
                        },
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    })
                    .catch(err => {
                        logger.logText('ERROR', `Error updating IRT limit message: ${err}`);
                    });

                return;
            }

            const deactivateIrtButton = new ButtonBuilder()
                .setCustomId(`deactivate-irt|${msg.id}`)
                .setLabel(localization(language, 'sheet-send|deactivate-irt-button'))
                .setStyle(ButtonStyle.Secondary);

            const actionRow = new ActionRowBuilder();
            actionRow.addComponents(deactivateIrtButton);

            await rest
                .patch(Routes.channelMessage(channelId, msg.id), {
                    body: {
                        components: [actionRow]
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .catch(err => {
                    logger.logText('ERROR', `Error adding deactivate IRT button: ${err}`);
                });
        } else {
            await int.reply({
                ...(syncRequested
                    ? {
                          content: localization(language, 'sheet-send|sync-only-guild')
                      }
                    : {}),
                embeds: embeds
            });
        }
    },
    autocomplete(int: Interaction, language: Available_Languages) {
        const sheets = sheetNameCache.get(int.kami_user?.id!);

        if (sheets) {
            let sheetNames: Set<string> = new Set();
            let sheetsNamesArray: { name: string; value: string }[] = [];

            let search = similaritySearch(int.getArgs().get('sheet_name').value, sheets);

            for (let s = 0; s < 6; s++) {
                if (sheetNames.size <= 6 && search.allMatches[s]) {
                    sheetNames.add(search.allMatches[s].value);
                }
            }

            for (let sheet of sheetNames) {
                sheetsNamesArray.push({
                    name: sheet,
                    value: sheet
                });
            }

            int.autocomplete(sheetsNamesArray);
        } else {
            int.autocomplete([]);
        }
    }
};

function createSheetEmbedInternal(sheet: Sheet, language: Available_Languages) {
    const embeds: EmbedBuilder[] = [];
    const limitedFeatures: string[] = [];
    const legacyDescription = { value: '' };

    if (sheet.legacy === true) {
        const rawLegacyAttributes = sheet.attributes as unknown;
        const legacyAttributes =
            rawLegacyAttributes && typeof rawLegacyAttributes === 'object' && !Array.isArray(rawLegacyAttributes)
                ? (rawLegacyAttributes as Record<string, string | number>)
                : {};
        const attributeListSize = Object.keys(legacyAttributes).length;
        const sectionListSize = Math.max(1, Math.ceil(attributeListSize / 25));
        const sections: Sheet_Section[] = [];

        for (let s = 0; s < sectionListSize; s++) {
            sections.push({
                name: `Info ${s + 1}`,
                attributes: [],
                position: s,
                type: Section_Type.STANDARD
            });
        }

        let absolutePosition = 0;
        let sectionPosition = 0;
        let section = 0;

        for (const attributeName of Object.keys(legacyAttributes)) {
            if (sectionPosition >= 25) {
                sectionPosition = 0;
                section++;
            }

            const value = legacyAttributes[attributeName];

            sections[section].attributes.push({
                name: attributeName,
                value: value,
                type: isNaN(Number(value)) ? Attribute_Type.TEXT : Attribute_Type.NUMBER,
                position: absolutePosition
            });

            absolutePosition++;
            sectionPosition++;
        }

        sheet = {
            ...sheet,
            attributes: { sections },
            sheet_layout: null,
            legacy: true
        };
    }

    const rawSections = (sheet.attributes as { sections?: unknown } | null | undefined)?.sections;
    const sections: Sheet_Section[] = Array.isArray(rawSections) ? (rawSections as Sheet_Section[]) : [];

    const addStandardAttribute = (embed: EmbedBuilder, attribute: Attribute): void => {
        let processedAttribute: false | string | { name: string; value: string; inline?: boolean } = false;

        switch (Number(attribute.type)) {
            case Attribute_Type.TEXT:
                // @ts-ignore
                processedAttribute = toTextAttribute(attribute);
                break;
            case Attribute_Type.NUMBER:
                // @ts-ignore
                processedAttribute = toNumberAttribute(attribute);
                break;
            case Attribute_Type.IMAGE:
                // @ts-ignore
                processedAttribute = toImageAttribute(attribute);
                break;
            case Attribute_Type.LIST:
                // @ts-ignore
                processedAttribute = toListAttribute(attribute);
                break;
            case Attribute_Type.BAR:
                // @ts-ignore
                processedAttribute = toBarAttribute(attribute);
                break;
            default:
                limitedFeatures.push(
                    localization(language, 'sheet-send|missing-attribute', [
                        { replace: '$attribute$', value: attribute.name }
                    ])
                );
                return;
        }

        if (processedAttribute === false) {
            limitedFeatures.push(
                localization(language, 'sheet-send|missing-attribute', [
                    { replace: '$attribute$', value: attribute.name }
                ])
            );
            return;
        }

        if (typeof processedAttribute === 'string') {
            const [local, reason, position] = processedAttribute.split('|');
            const key =
                local === 'name'
                    ? 'sheet-send|name-overflow'
                    : reason === 'invalid'
                      ? 'sheet-send|value-invalid'
                      : 'sheet-send|value-overflow';

            embed.addFields({
                name: 'Erro',
                value: localization(language, key, [{ replace: '$position$', value: position }])
            });
            return;
        }

        if (sheet.legacy && typeof processedAttribute === 'object') {
            if (processedAttribute.name === 'descricao') {
                legacyDescription.value = processedAttribute.value;
                return;
            }

            if (processedAttribute.name === 'imagem') {
                const thumbnail = safeImageUrl(processedAttribute.value);

                if (thumbnail) {
                    embed.setThumbnail(thumbnail);
                }

                return;
            }
        }

        if (Number(attribute.type) === Attribute_Type.IMAGE) {
            // @ts-ignore
            const thumbnail = safeImageUrl(processedAttribute.thumbnail?.url ?? processedAttribute.value);

            if (thumbnail) {
                embed.setThumbnail(thumbnail);
            } else {
                limitedFeatures.push(
                    localization(language, 'sheet-send|missing-attribute', [
                        { replace: '$attribute$', value: attribute.name }
                    ])
                );
            }

            return;
        }

        embed.addFields(processedAttribute);
    };

    for (const rawSection of sections) {
        if (!rawSection || typeof rawSection !== 'object') {
            continue;
        }

        const section: Sheet_Section = {
            ...rawSection,
            attributes: Array.isArray(rawSection.attributes) ? rawSection.attributes : []
        };
        const embed = new EmbedBuilder();
        const sectionType = Number(section.type);
        embed.setTitle(section.name);
        embed.setColor(parseInt(config.EMBED_COLOR));

        if (sectionType === Section_Type.DESCRIPTION) {
            const description = section.attributes.find(attribute => Number(attribute.type) === Attribute_Type.TEXT);

            if (description) {
                embed.setDescription(toTextValue(description.value));
            } else {
                embed.setDescription(localization(language, 'sheet-send|empty-section'));
            }
        } else if (sectionType === Section_Type.HEADER) {
            const header = getHeaderInfo(sheet, section);

            if (header?.subtitle) {
                embed.setDescription(toTextValue(header.subtitle.value));
            }

            if (header?.image) {
                const thumbnail = safeImageUrl(header.image.value);

                if (thumbnail) {
                    embed.setThumbnail(thumbnail);
                }
            }

            const headerNames = new Set(
                [header?.title?.name, header?.subtitle?.name, header?.image?.name].filter(Boolean) as string[]
            );

            for (const attribute of section.attributes) {
                if (!headerNames.has(attribute.name)) {
                    addStandardAttribute(embed, attribute);
                }
            }
        } else if (sectionType === Section_Type.STATUS) {
            const statusAttribute = section.attributes.find(
                attribute => Number(attribute.type) === Attribute_Type.STATUS
            );
            const status = statusAttribute ? toStatusAttribute(statusAttribute, language) : null;

            if (status) {
                embed.addFields(status.field);

                if (status.truncated) {
                    limitedFeatures.push(localization(language, 'sheet-send|status-truncated'));
                }
            } else {
                embed.setDescription(localization(language, 'sheet-send|empty-section'));
            }
        } else if (sectionType === Section_Type.GALLERY) {
            const gallery = toGalleryAttribute(section, language);

            if (gallery) {
                embed.setThumbnail(gallery.thumbnail);
                embed.addFields(gallery.field);

                if (gallery.extra > 0) {
                    limitedFeatures.push(
                        localization(language, 'sheet-send|gallery-more', [
                            { replace: '$count$', value: gallery.extra }
                        ])
                    );
                }
            } else {
                embed.setDescription(localization(language, 'sheet-send|empty-section'));
            }
        } else if (sectionType === Section_Type.TABLE) {
            const tableAttribute = section.attributes.find(
                attribute => Number(attribute.type) === Attribute_Type.TABLE
            );
            const table = tableAttribute ? toTableAttribute(tableAttribute) : null;

            if (table) {
                embed.addFields(table.field);

                if (table.truncated) {
                    limitedFeatures.push(localization(language, 'sheet-send|table-truncated'));
                }
            } else {
                embed.setDescription(localization(language, 'sheet-send|empty-section'));
            }
        } else if (sectionType === Section_Type.STANDARD) {
            for (const attribute of section.attributes) {
                addStandardAttribute(embed, attribute);
            }
        } else {
            limitedFeatures.push(
                localization(language, 'sheet-send|missing-attribute', [
                    { replace: '$attribute$', value: section.name }
                ])
            );

            for (const attribute of section.attributes) {
                addStandardAttribute(embed, attribute);
            }
        }

        embeds.push(embed);
    }

    if (legacyDescription.value) {
        const descriptionEmbed = new EmbedBuilder();
        descriptionEmbed.setTitle(localization(language, 'sheet-send|description'));
        descriptionEmbed.setDescription(legacyDescription.value);
        descriptionEmbed.setColor(parseInt(config.EMBED_COLOR));

        embeds.push(descriptionEmbed);
    }

    if (embeds.length === 0) {
        embeds.push(
            new EmbedBuilder()
                .setTitle(sheet.sheet_name)
                .setDescription(localization(language, 'sheet-send|empty-sheet'))
                .setColor(parseInt(config.EMBED_COLOR))
        );
    }

    const siteUrl = getSheetSiteUrl(sheet);
    const limitedField = buildLimitedField(limitedFeatures, language, siteUrl);

    if (limitedField) {
        embeds[0].addFields(limitedField);
    }

    if (sheet.legacy) {
        let username = '';

        if (sheet.user?.username != null) {
            username = sheet.user.username;
        } else if (sheet.user?.discord_id != null) {
            // @ts-ignore
            username = `ID: ${sheet.user.discord_id}`;
        } else {
            username = localization(language, 'sheet-send|unknown-user');
        }

        embeds[0].setTitle(
            localization(language, 'sheet-send|title-legacy', [
                { replace: '$sheet$', value: sheet.sheet_name },
                { replace: '$username$', value: username }
            ])
        );
    } else {
        const firstSection = sections.find(section => section && typeof section === 'object');

        embeds[0].setTitle(
            localization(language, 'sheet-send|title', [
                { replace: '$section$', value: firstSection?.name ?? sheet.sheet_name },
                { replace: '$sheet$', value: sheet.sheet_name },
                {
                    replace: '$username$',
                    value: sheet.user?.username ?? localization(language, 'sheet-send|unknown-user')
                }
            ])
        );
    }

    if (siteUrl) {
        const firstSection = sections.find(section => section && typeof section === 'object');
        const header = firstSection ? getHeaderInfo(sheet, firstSection) : null;
        const authorName = header?.title ? toTextValue(header.title.value).trim() : '';

        embeds[0].setAuthor({
            name: authorName || sheet.sheet_name,
            url: siteUrl
        });
    }

    if (embeds.length > MAX_EMBEDS) {
        const omitted = embeds.length - (MAX_EMBEDS - 1);
        const summary = new EmbedBuilder()
            .setTitle(localization(language, 'sheet-send|more-sections-title'))
            .setDescription(
                localization(language, 'sheet-send|more-sections', [{ replace: '$count$', value: omitted }])
            )
            .setColor(parseInt(config.EMBED_COLOR));

        embeds.splice(MAX_EMBEDS - 1, embeds.length - (MAX_EMBEDS - 1), summary);
    }

    return embeds;
}

function createSheetEmbed(sheet: Sheet, language: Available_Languages): EmbedBuilder[] {
    try {
        const embeds = createSheetEmbedInternal(sheet, language);

        assertSheetEmbedLimits(embeds);

        return embeds;
    } catch (err) {
        if (err instanceof SheetTooComplexError) {
            throw err;
        }

        // O EmbedBuilder lança para título/author/description/fields fora dos
        // limites do Discord. Para o chamador, tudo isso significa a mesma
        // coisa: a ficha não cabe no Discord.
        throw new SheetTooComplexError('Sheet does not fit Discord embed limits', { cause: err });
    }
}

export { createSheetEmbed };
