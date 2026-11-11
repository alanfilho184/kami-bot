import { ButtonBuilder, ActionRowBuilder } from '@discordjs/builders';
import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import { sheetErrorKey } from '../../resources/localization/sheet-errors';
import { ButtonStyle } from 'discord-api-types/v10';
import sheetNameCache from '../../resources/cache/sheet-name.cache';
import { similaritySearch } from '../../resources/utils/string-similarity';
import SheetController from '../../controllers/sheet.controller';
import SheetServices from '../../services/sheet.services';
import rest from '../../configs/rest';
import { Routes } from 'discord-api-types/rest/v10';
import { randomUUID } from 'crypto';
import actionHandler from '../../resources/utils/action-handler';
import logger from '../../configs/logger';
import { createSheetEmbed } from './sheet-send';
import syncSheet from '../../resources/utils/sync-sheet';
import migrateLegacySheet from '../../resources/utils/migrate-legacy-sheet';
import { buildSheetSiteUrl, isSpecialSection, renameLayoutAttribute } from '../../resources/utils/sheet-site';
import { Command_Category } from '../../types/enums';

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'ficha_renomear_atributo',
        'en-us': 'sheet_rename_attribute'
    },
    fullNames: {
        'pt-br': 'Renomear Atributo',
        'en-us': 'Rename Attribute'
    },
    descriptions: {
        'pt-br': 'Renomeia um atributo dentro de uma seção.',
        'en-us': 'Rename an attribute inside a section.'
    },
    arguments: {
        'pt-br': [
            {
                name: 'nome_da_ficha',
                description: 'Nome da ficha.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'secao',
                description: 'Seção que contém o atributo.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'atributo',
                description: 'Atributo que será renomeado.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'novo_nome',
                description: 'Novo nome do atributo.',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ],
        'en-us': [
            {
                name: 'sheet_name',
                description: 'Sheet name.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'section',
                description: 'Section that contains the attribute.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'attribute',
                description: 'Attribute to rename.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'new_name',
                description: 'New attribute name.',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ]
    },
    type: 1,
    category: Command_Category.SHEET_ALTER,
    run: async (int: Interaction, language: Available_Languages) => {
        const sheetName = int.getArgs().get('sheet_name')?.value || int.getArgs().get('nome_da_ficha')?.value;
        const section = int.getArgs().get('section')?.value || int.getArgs().get('secao')?.value;
        const attribute = int.getArgs().get('attribute')?.value || int.getArgs().get('atributo')?.value;
        const newName = int.getArgs().get('new_name')?.value || int.getArgs().get('novo_nome')?.value;

        let sheet = await SheetController.getByUserIdAndSheetName(int.kami_user?.id!, sheetName);

        if (!sheet) {
            return int.reply({ content: localization(language, 'sheet|sheet-not-found') });
        }

        if (sheet.user_id !== int.kami_user?.id) {
            return int.reply({ content: localization(language, 'sheet|not-sheet-owner') });
        }

        if (sheet.legacy == true) {
            sheet = (await migrateLegacySheet(sheet)) ?? sheet;
        }

        const existingSection = sheet.attributes.sections.find(s => s.name === section);

        if (existingSection && isSpecialSection(existingSection)) {
            return int.reply({
                content: localization(language, 'sheet|edit-on-site', [
                    { replace: '$url$', value: buildSheetSiteUrl(sheet) }
                ])
            });
        }

        const validated = await SheetServices.validateRenameAttribute(sheet, section, attribute, newName);

        if (validated instanceof Array) {
            const errors = new Set<string>();
            for (let err of validated) {
                errors.add(localization(language, sheetErrorKey(err.field, err.code)));
            }

            if (errors.size < 2) {
                return int.reply({
                    content: localization(language, 'sheet|single-validation-error') + Array.from(errors).join('')
                });
            } else {
                return int.reply({
                    content: localization(language, 'sheet|multiple-validation-errors') + Array.from(errors).join('\n')
                });
            }
        }

        const modifiedSheet = validated as Sheet;

        renameLayoutAttribute(modifiedSheet, section, attribute, newName);

        const tempId = randomUUID();

        const buttonConfirm = new ButtonBuilder()
            .setCustomId(`$a$confirm-rename-attribute|${tempId}`)
            .setLabel(localization(language, 'sheet|confirm-rename-button'))
            .setStyle(ButtonStyle.Success);

        const buttonCancel = new ButtonBuilder()
            .setCustomId(`$a$cancel-rename-attribute|${tempId}`)
            .setLabel(localization(language, 'sheet|cancel-rename-button'))
            .setStyle(ButtonStyle.Secondary);

        const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttonConfirm, buttonCancel);

        const msg = (await int.reply({
            content: localization(language, 'sheet|confirm-rename-attribute-message', [
                { replace: '$sheet$', value: sheetName },
                { replace: '$section$', value: section },
                { replace: '$attribute$', value: attribute },
                { replace: '$new$', value: newName }
            ]),
            components: [actionRow]
        })) as { id: string; channel_id: string; webhook_id: string };

        actionHandler.registerAction(`$a$confirm-rename-attribute|${tempId}`, {
            action: async (comp: Interaction) => {
                comp.acknowledge();

                try {
                    await SheetController.updateById(sheet.id, modifiedSheet);

                    syncSheet({ sheet: modifiedSheet, language: language, user: int.kami_user as User & User_Config });

                    await rest.patch(Routes.webhookMessage(int.application_id, comp.token, msg.id), {
                        body: {
                            content: localization(language, 'sheet|attribute-renamed'),
                            components: []
                        },
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (err) {
                    logger.logText('ERROR', `Error renaming attribute: ${err}`);
                }
            },
            singleUse: true,
            respondOnlyToUserId: int.user.id
        });

        actionHandler.registerAction(`$a$cancel-rename-attribute|${tempId}`, {
            action: (comp: Interaction) => {
                comp.acknowledge();

                rest.patch(Routes.webhookMessage(int.application_id, comp.token, msg.id), {
                    body: {
                        content: localization(language, 'sheet|rename-cancelled'),
                        components: [
                            {
                                type: 1,
                                components: [buttonConfirm.setDisabled().toJSON(), buttonCancel.setDisabled().toJSON()]
                            }
                        ]
                    },
                    headers: { 'Content-Type': 'application/json' }
                }).catch(err => {
                    logger.logText('ERROR', `Error updating cancel rename attribute message: ${err}`);
                });
            },
            singleUse: true,
            respondOnlyToUserId: int.user.id
        });
    },
    async autocomplete(int: Interaction, language: Available_Languages) {
        let focused = int.data.options!.filter(arg => arg.focused === true)[0];

        if (focused.name === 'sheet_name' || focused.name === 'nome_da_ficha') {
            const sheets = sheetNameCache.get(int.kami_user?.id!);

            if (sheets) {
                let sheetNames: Set<string> = new Set();
                let sheetsNamesArray: { name: string; value: string }[] = [];

                let search = similaritySearch(int.getArgs().get(focused.name).value, sheets);

                for (let s = 0; s < 6; s++) {
                    if (sheetNames.size <= 6 && search.allMatches[s]) {
                        sheetNames.add(search.allMatches[s].value);
                    }
                }

                for (let sheet of sheetNames) {
                    sheetsNamesArray.push({ name: sheet, value: sheet });
                }

                int.autocomplete(sheetsNamesArray);
            } else {
                int.autocomplete([]);
            }
        } else if (focused.name === 'section' || focused.name === 'secao') {
            if (int.getArgs().get('sheet_name')) {
                let sheet = await SheetController.getByUserIdAndSheetName(
                    int.kami_user?.id!,
                    int.getArgs().get('sheet_name').value
                );

                if (!sheet) {
                    return int.autocomplete([]);
                } else {
                    if (sheet.legacy == true) {
                        sheet = (await migrateLegacySheet(sheet)) ?? sheet;
                    }
                    let sections: Set<string> = new Set();
                    let sectionsArray: { name: string; value: string }[] = [];

                    for (let s of sheet.attributes.sections) {
                        sections.add(s.name);
                    }

                    let search = similaritySearch(int.getArgs().get(focused.name).value, Array.from(sections));

                    for (let s = 0; s < 6; s++) {
                        if (sectionsArray.length <= 6 && search.allMatches[s]) {
                            sectionsArray.push({ name: search.allMatches[s].value, value: search.allMatches[s].value });
                        }
                    }

                    int.autocomplete(sectionsArray);
                }
            } else {
                int.autocomplete([]);
            }
        } else if (focused.name === 'attribute' || focused.name === 'atributo') {
            if (int.getArgs().get('sheet_name')) {
                let sheet = await SheetController.getByUserIdAndSheetName(
                    int.kami_user?.id!,
                    int.getArgs().get('sheet_name').value
                );

                if (!sheet) {
                    return int.autocomplete([]);
                } else {
                    if (sheet.legacy == true) {
                        sheet = (await migrateLegacySheet(sheet)) ?? sheet;
                    }

                    let section = sheet.attributes.sections.find(s => s.name === int.getArgs().get('section').value);

                    if (!section) {
                        return int.autocomplete([]);
                    } else {
                        let attributes: Set<string> = new Set();
                        let attributesArray: { name: string; value: string }[] = [];

                        for (let a of section.attributes) {
                            attributes.add(a.name);
                        }

                        let search = similaritySearch(int.getArgs().get(focused.name).value, Array.from(attributes));

                        for (let s = 0; s < 6; s++) {
                            if (attributesArray.length <= 6 && search.allMatches[s]) {
                                attributesArray.push({
                                    name: search.allMatches[s].value,
                                    value: search.allMatches[s].value
                                });
                            }
                        }

                        int.autocomplete(attributesArray);
                    }
                }
            } else {
                int.autocomplete([]);
            }
        }
    }
};
