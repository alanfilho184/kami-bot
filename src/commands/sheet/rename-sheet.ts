import { ActionRowBuilder, ButtonBuilder } from '@discordjs/builders';
import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import SheetController from '../../controllers/sheet.controller';
import sheetNameCache from '../../resources/cache/sheet-name.cache';
import { similaritySearch } from '../../resources/utils/string-similarity';
import { randomUUID } from 'crypto';
import actionHandler from '../../resources/utils/action-handler';
import { ButtonStyle, Routes } from 'discord-api-types/v10';
import rest from '../../configs/rest';
import logger from '../../configs/logger';
import { Sheet_Name } from '../../types/validations';
import syncSheet from '../../resources/utils/sync-sheet';
import { Command_Category } from '../../types/enums';

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'renomear_ficha',
        'en-us': 'rename_sheet'
    },
    fullNames: {
        'pt-br': 'Renomear Ficha',
        'en-us': 'Rename Sheet'
    },
    descriptions: {
        'pt-br': 'Renomeia uma ficha criada por você.',
        'en-us': 'Renames a sheet created by you.'
    },
    arguments: {
        'pt-br': [
            {
                name: 'nome_da_ficha',
                description: 'Nome da ficha que deseja renomear.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'novo_nome_da_ficha',
                description: 'O novo nome para a ficha.',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ],
        'en-us': [
            {
                name: 'sheet_name',
                description: 'The name of the sheet you want to rename.',
                type: 'STRING',
                required: true,
                autocomplete: true
            },
            {
                name: 'new_sheet_name',
                description: 'The new name for the sheet.',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ]
    },
    type: 1,
    category: Command_Category.SHEET_ALTER,
    run: async (int: Interaction, language: Available_Languages) => {
        const sheetName = int.getArgs().get('sheet_name').value;
        let newSheetName = int.getArgs().get('new_sheet_name').value;

        const sheet = await SheetController.getByUserIdAndSheetName(int.kami_user!.id, sheetName);

        if (!sheet) {
            return int.reply({
                content: localization(language, 'rename-sheet|sheet-not-found', [
                    { replace: '$sheet$', value: sheetName }
                ])
            });
        } else {
            if (sheetName === newSheetName) {
                return int.reply({
                    content: localization(language, 'rename-sheet|same-name', [
                        { replace: '$sheet$', value: sheetName }
                    ])
                });
            }

            const newSheetWithSameName = await SheetController.getByUserIdAndSheetName(int.kami_user!.id, newSheetName);

            if (newSheetWithSameName) {
                return int.reply({
                    content: localization(language, 'rename-sheet|sheet-name-already-exists', [
                        { replace: '$sheet$', value: newSheetName }
                    ])
                });
            }

            const tempId = randomUUID();

            const buttonConfirm = new ButtonBuilder()
                .setCustomId(`$a$confirm-rename-sheet|${tempId}`)
                .setLabel(localization(language, 'rename-sheet|confirm-rename-sheet-button'))
                .setStyle(ButtonStyle.Success);

            const buttonCancel = new ButtonBuilder()
                .setCustomId(`$a$cancel-rename-sheet|${tempId}`)
                .setLabel(localization(language, 'rename-sheet|cancel-rename-sheet-button'))
                .setStyle(ButtonStyle.Danger);

            const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttonConfirm, buttonCancel);

            const msg = (await int.reply({
                content: localization(language, 'rename-sheet|confirm-rename-sheet-message', [
                    {
                        replace: '$sheet$',
                        value: sheetName
                    },
                    {
                        replace: '$new-sheet$',
                        value: newSheetName
                    }
                ]),
                components: [actionRow]
            })) as { id: string; channel_id: string; webhook_id: string };

            actionHandler.registerAction(`$a$confirm-rename-sheet|${tempId}`, {
                action: async (comp: Interaction) => {
                    comp.acknowledge();

                    try {
                        newSheetName = new Sheet_Name(newSheetName).sheet_name;
                    } catch (err: any) {
                        let errorMsg = '';
                        if (err.code == 'Exceeded the maximum of 32 characters') {
                            errorMsg = localization(language, 'sheet|error-sheet-name-too-long');
                        } else if (err.code == 'Contains invalid characters') {
                            errorMsg = localization(language, 'sheet|error-sheet-name-invalid');
                        } else {
                            errorMsg = localization(language, 'sheet|error-sheet-name-invalid');
                            logger.logText('ERROR', `Unknown sheet name validation error: ${err}`);
                        }

                        rest.patch(Routes.webhookMessage(int.application_id, comp.token, msg.id), {
                            body: {
                                content: errorMsg,
                                components: []
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });
                        return;
                    }

                    SheetController.renameById(sheet.id, newSheetName)
                        .then(updatedSheet => {
                            sheetNameCache.remove(int.kami_user!.id, sheetName);
                            sheetNameCache.upsert(int.kami_user!.id, sheet.id, newSheetName);

                            syncSheet({
                                sheet: {
                                    ...(updatedSheet ?? sheet),
                                    sheet_name: newSheetName,
                                    last_use: updatedSheet?.last_use ?? new Date()
                                },
                                language: language,
                                user: int.kami_user as User & User_Config
                            });

                            rest.patch(Routes.webhookMessage(int.application_id, comp.token, msg.id), {
                                body: {
                                    content: localization(language, 'rename-sheet|sheet-renamed', [
                                        { replace: '$sheet$', value: sheetName },
                                        { replace: '$new-sheet$', value: newSheetName }
                                    ]),
                                    components: []
                                },
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            }).catch(err => {
                                logger.logText('ERROR', `Error renaming sheet message: ${err}`);
                            });
                        })
                        .catch(err => {
                            logger.logText('ERROR', `Error renaming sheet: ${err}`);
                        });
                },
                singleUse: true,
                respondOnlyToUserId: int.user.id
            });

            actionHandler.registerAction(`$a$cancel-rename-sheet|${tempId}`, {
                action: (comp: Interaction) => {
                    comp.acknowledge();

                    rest.patch(Routes.webhookMessage(int.application_id, comp.token, msg.id), {
                        body: {
                            content: localization(language, 'rename-sheet|cancel-rename-sheet'),
                            components: [
                                {
                                    type: 1,
                                    components: [
                                        buttonConfirm.setDisabled().toJSON(),
                                        buttonCancel.setDisabled().toJSON()
                                    ]
                                }
                            ]
                        },
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }).catch(err => {
                        logger.logText('ERROR', `Error updating cancel rename sheet message: ${err}`);
                    });
                },
                singleUse: true,
                respondOnlyToUserId: int.user.id
            });

            return;
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
