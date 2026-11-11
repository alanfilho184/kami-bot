import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import { Available_Languages, Command_Category } from '../../types/enums';
import { InteractionResponseFlags } from 'discord-interactions';
import SheetController from '../../controllers/sheet.controller';
import UserController from '../../controllers/user.controller';
import SheetServices from '../../services/sheet.services';
import { buildSheetTooComplexContent, createSheetEmbed, SheetTooComplexError } from './sheet-send';

const snowflakeRegex = /^\d{17,19}$/;
const kamiIdRegex = /^\d+$/;

function buildEmbeds(
    sheet: Sheet,
    language: Available_Languages
): { embeds: ReturnType<typeof createSheetEmbed>; tooComplex?: never } | { embeds?: never; tooComplex: string } {
    try {
        return { embeds: createSheetEmbed(sheet, language) };
    } catch (err) {
        if (err instanceof SheetTooComplexError) {
            return { tooComplex: buildSheetTooComplexContent(sheet, language) };
        }

        throw err;
    }
}

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'ficha_ver',
        'en-us': 'sheet_view'
    },
    fullNames: {
        'pt-br': 'Ver Ficha',
        'en-us': 'View Sheet'
    },
    descriptions: {
        'pt-br': 'Visualiza a ficha de outro usuário. Se privada, é necessário informar a senha.',
        'en-us': "View another user's sheet. If private, password is required."
    },
    arguments: {
        'pt-br': [
            {
                name: 'usuario',
                description: 'Nome de usuário dono da ficha.',
                type: 'STRING',
                required: true,
                autocomplete: false
            },
            {
                name: 'nome_da_ficha',
                description: 'Nome da ficha que deseja visualizar.',
                type: 'STRING',
                required: true,
                autocomplete: false
            },
            {
                name: 'senha',
                description: 'Senha da ficha (se privada).',
                type: 'STRING',
                required: false,
                autocomplete: false
            }
        ],
        'en-us': [
            {
                name: 'username',
                description: 'Owner username of the sheet.',
                type: 'STRING',
                required: true,
                autocomplete: false
            },
            {
                name: 'sheet_name',
                description: 'The name of the sheet you want to view.',
                type: 'STRING',
                required: true,
                autocomplete: false
            },
            {
                name: 'password',
                description: 'Sheet password (if private).',
                type: 'STRING',
                required: false,
                autocomplete: false
            }
        ]
    },
    type: 1,
    category: Command_Category.SHEET_SEND,
    doNotAcknowledge: true,
    run: async (int: Interaction, language: Available_Languages) => {
        await int.acknowledge(true);

        const username = int.getArgs().get('username')?.value || int.getArgs().get('usuario')?.value;
        const sheetName = int.getArgs().get('sheet_name')?.value || int.getArgs().get('nome_da_ficha')?.value;
        const password = int.getArgs().get('password')?.value || int.getArgs().get('senha')?.value;

        if (!username || !sheetName) {
            return int.reply({
                content: localization(language, 'sheet-view|invalid-args')
            });
        }

        let user: User | null = null;
        if (username.startsWith('<@') && username.endsWith('>')) {
            const id = username.slice(2, -1);
            user = await UserController.getByDiscordId(id);
        } else if (snowflakeRegex.test(username)) {
            user = await UserController.getByDiscordId(username);
        } else if (kamiIdRegex.test(username)) {
            user = await UserController.getById(parseInt(username));
        } else {
            user = await UserController.searchByUsername(username);
        }

        if (!user) {
            return int.reply({
                content: localization(language, 'sheet-view|user-not-found', [
                    { replace: '$username$', value: username }
                ])
            });
        }

        const sheet = await SheetController.getByUserIdAndSheetName(user?.id, sheetName);

        if (!sheet) {
            return int.reply({
                content: localization(language, 'sheet-view|sheet-not-found', [
                    { replace: '$sheet$', value: sheetName },
                    { replace: '$username$', value: username }
                ])
            });
        } else {
            if (sheet.user_id === int.kami_user?.id) {
                sheet.user = int.kami_user!;
                const result = buildEmbeds(sheet, language);

                if (result.tooComplex) {
                    return int.reply({ content: result.tooComplex });
                }

                return int.reply({
                    content: localization(language, 'sheet-view|own-sheet'),
                    embeds: result.embeds
                });
            }

            if (sheet.is_public) {
                sheet.user = user;
                const result = buildEmbeds(sheet, language);

                if (result.tooComplex) {
                    return int.reply({ content: result.tooComplex });
                }

                return int.reply({ embeds: result.embeds });
            } else {
                if (!password) {
                    return int.reply({
                        content: localization(language, 'sheet-view|password-required')
                    });
                }

                const valid = await SheetServices.verifySheetPassword(sheet as Sheet, password);

                if (!valid) {
                    return int.reply({
                        content: localization(language, 'sheet-view|invalid-password')
                    });
                } else {
                    sheet.user = user;
                    const result = buildEmbeds(sheet, language);

                    if (result.tooComplex) {
                        return int.reply({ content: result.tooComplex });
                    }

                    return int.reply({ embeds: result.embeds });
                }
            }
        }
    }
};
