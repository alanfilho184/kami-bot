import {
    SlashCommandBuilder,
    SlashCommandStringOption,
    SlashCommandIntegerOption,
    SlashCommandUserOption,
    SlashCommandAttachmentOption,
    ContextMenuCommandBuilder
} from '@discordjs/builders';
import rest from '../../configs/rest';
import { ApplicationIntegrationType, InteractionContextType, Locale, Routes } from 'discord-api-types/v10';
import { Interaction } from '../../resources/utils/interaction-handler';
import commandsBot from '..';
import logger from '../../configs/logger';
import { Command_Category } from '../../types/enums';

function languageFilter(language: string | any) {
    language = language.replace('_', '-').split('-');

    if (language.length > 1) {
        language = language[0] + '-' + language[1].toUpperCase();
    } else {
        language = language[0];
    }

    return language;
}

export default {
    ownerOnly: true,
    commandNames: {
        'pt-br': 'reloadslashs',
        'en-us': 'reloadslashs'
    },
    fullNames: {
        'pt-br': 'Reload Slashs',
        'en-us': 'Reload Slashs'
    },
    descriptions: {
        'pt-br': 'Recarrega os comandos do bot',
        'en-us': 'Reloads the bot commands'
    },
    type: 1,
    category: Command_Category.OWNER_ONLY,
    run: async (int: Interaction, language: Available_Languages) => {
        const slashs: any = await rest.get(Routes.applicationCommands(int.application_id));

        const commands = new Array();
        const commandsOwnerOnly = new Array();

        commandsBot.forEach(command => {
            if (command.type == 1) {
                const newCommand = new SlashCommandBuilder();

                if (command.ownerOnly) {
                    newCommand.setDefaultMemberPermissions('0');
                    newCommand.setName(command.commandNames['en-us']).setDescription(command.descriptions['en-us']);

                    // Apply name/description localizations for ownerOnly commands
                    for (let language in command.commandNames) {
                        const name = command.commandNames[language];
                        const description = command.descriptions[language];

                        const filteredLang = languageFilter(language);

                        if (!Object.values(Locale).includes(filteredLang as Locale)) {
                            throw new Error(`Invalid language: ${filteredLang}`);
                        } else {
                            //@ts-ignore
                            newCommand
                                .setNameLocalization(filteredLang as Locale, name)
                                .setDescriptionLocalization(filteredLang as Locale, description);
                        }
                    }

                    if (command.arguments) {
                        const localizedArgsNames: any = {};
                        const localizedArgsDescriptions: any = {};

                        for (let i = 0; i < Object.keys(command.arguments['en-us']).length; i++) {
                            const argEn = command.arguments['en-us'][i].name;

                            for (let language of Object.keys(command.arguments)) {
                                const arg = command.arguments[language][i];
                                const filteredLang = languageFilter(language);

                                if (!localizedArgsNames[argEn]) {
                                    localizedArgsNames[argEn] = {};
                                }

                                if (!localizedArgsDescriptions[argEn]) {
                                    localizedArgsDescriptions[argEn] = {};
                                }

                                localizedArgsNames[argEn][filteredLang] = arg.name;
                                localizedArgsDescriptions[argEn][filteredLang] = arg.description;
                            }
                        }

                        for (let a in command.arguments['en-us']) {
                            if (command.arguments['en-us'][a].type == 'STRING') {
                                if (
                                    command.arguments['en-us'][a].autocomplete &&
                                    command.arguments!['en-us'][a].choices &&
                                    command.arguments!['en-us'][a].choices.length > 0
                                ) {
                                    throw new Error(
                                        `Argument ${command.arguments['en-us'][a].name} has choices and autocomplete`
                                    );
                                }

                                const localizedOptionsChoicesNames: any = {};
                                if (!command.arguments['en-us'][a].choices) {
                                    for (let i = 0; i < Object.keys(command.arguments['en-us']).length; i++) {
                                        const argEn = command.arguments['en-us'][i].name;

                                        for (let language of Object.keys(command.arguments)) {
                                            const arg = command.arguments[language][i];

                                            if (arg.choices) {
                                                const filteredLang = languageFilter(language);

                                                if (!localizedOptionsChoicesNames[argEn]) {
                                                    localizedOptionsChoicesNames[argEn] = {};
                                                }

                                                localizedOptionsChoicesNames[argEn][filteredLang] = {};

                                                for (let c in arg.choices) {
                                                    localizedOptionsChoicesNames[argEn][filteredLang][
                                                        arg.choices[c].return
                                                    ] = arg.choices[c].name;
                                                }
                                            }
                                        }
                                    }
                                }

                                newCommand.addStringOption((option: SlashCommandStringOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    if (
                                        command.arguments!['en-us'][a].choices &&
                                        command.arguments!['en-us'][a].choices.length > 0
                                    ) {
                                        if (command.arguments!['en-us'][a].choices) {
                                            for (let c in command.arguments!['en-us'][a].choices) {
                                                const choice = command.arguments!['en-us'][a].choices![c];

                                                const choiceNameLocalizations: any = {};

                                                for (let language of Object.keys(command.arguments!)) {
                                                    const filteredLang = languageFilter(language);
                                                    const choices = command.arguments![language][a].choices;
                                                    if (choices) {
                                                        const matchingChoice = choices.find(
                                                            c => c.return === choice.return
                                                        );
                                                        if (matchingChoice) {
                                                            choiceNameLocalizations[filteredLang] = matchingChoice.name;
                                                        }
                                                    }
                                                }

                                                option.addChoices({
                                                    name: command.arguments!['en-us'][a].choices![c].name,
                                                    value: `${command.arguments!['en-us'][a].choices![c].return}`,
                                                    name_localizations: choiceNameLocalizations
                                                });
                                            }
                                        }
                                    } else if (command.arguments!['en-us'][a].autocomplete) {
                                        option.setAutocomplete(command.arguments!['en-us'][a].autocomplete);
                                    }

                                    return option;
                                });
                            }
                            //@ts-ignore
                            else if (command.arguments['en-us'][a].type == 'INTEGER') {
                                newCommand.addIntegerOption((option: SlashCommandIntegerOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setAutocomplete(command.arguments!['en-us'][a].autocomplete)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    return option;
                                });
                            }
                            //@ts-ignore
                            else if (command.arguments['en-us'][a].type == 'USER') {
                                newCommand.addUserOption((option: SlashCommandUserOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    return option;
                                });
                            }
                            //@ts-ignore
                            else if (command.arguments['en-us'][a].type == 'ATTACHMENT') {
                                newCommand.addAttachmentOption((option: SlashCommandAttachmentOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    return option;
                                });
                            }
                        }
                    }

                    commandsOwnerOnly.push(newCommand);
                } else {
                    newCommand.setDefaultMemberPermissions(null);
                    newCommand.setName(command.commandNames['en-us']).setDescription(command.descriptions['en-us']);
                    newCommand.setIntegrationTypes([
                        ApplicationIntegrationType.GuildInstall,
                        ApplicationIntegrationType.UserInstall
                    ]);
                    newCommand.setContexts([
                        InteractionContextType.Guild,
                        InteractionContextType.BotDM,
                        InteractionContextType.PrivateChannel
                    ]);

                    for (let language in command.commandNames) {
                        const name = command.commandNames[language];
                        const description = command.descriptions[language];

                        language = languageFilter(language);

                        if (!Object.values(Locale).includes(language as Locale)) {
                            throw new Error(`Invalid language: ${language}`);
                        } else {
                            //@ts-ignore
                            newCommand
                                .setNameLocalization(language as Locale, name)
                                .setDescriptionLocalization(language as Locale, description);
                        }
                    }

                    if (command.arguments) {
                        const localizedArgsNames: any = {};
                        const localizedArgsDescriptions: any = {};

                        for (let i = 0; i < Object.keys(command.arguments['en-us']).length; i++) {
                            const argEn = command.arguments['en-us'][i].name;

                            for (let language of Object.keys(command.arguments)) {
                                const arg = command.arguments[language][i];

                                language = languageFilter(language);

                                if (!localizedArgsNames[argEn]) {
                                    localizedArgsNames[argEn] = {};
                                }

                                if (!localizedArgsDescriptions[argEn]) {
                                    localizedArgsDescriptions[argEn] = {};
                                }

                                localizedArgsNames[argEn][language] = arg.name;
                                localizedArgsDescriptions[argEn][language] = arg.description;
                            }
                        }

                        for (let a in command.arguments['en-us']) {
                            if (command.arguments['en-us'][a].type == 'STRING') {
                                if (
                                    command.arguments['en-us'][a].autocomplete &&
                                    command.arguments['en-us'][a].choices &&
                                    command.arguments['en-us'][a].choices.length > 0
                                ) {
                                    throw new Error(
                                        `Argument ${command.arguments['en-us'][a].name} has choices and autocomplete`
                                    );
                                }

                                const localizedOptionsChoicesNames: any = {};
                                if (!command.arguments['en-us'][a].choices) {
                                    for (let i = 0; i < Object.keys(command.arguments['en-us']).length; i++) {
                                        const argEn = command.arguments['en-us'][i].name;

                                        for (let language of Object.keys(command.arguments)) {
                                            const arg = command.arguments[language][i];

                                            if (arg.choices) {
                                                language = languageFilter(language);

                                                if (!localizedOptionsChoicesNames[argEn]) {
                                                    localizedOptionsChoicesNames[argEn] = {};
                                                }

                                                localizedOptionsChoicesNames[argEn][language] = {};

                                                for (let c in arg.choices) {
                                                    localizedOptionsChoicesNames[argEn][language][
                                                        arg.choices[c].return
                                                    ] = arg.choices[c].name;
                                                }
                                            }
                                        }
                                    }
                                }

                                newCommand.addStringOption((option: SlashCommandStringOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    if (
                                        command.arguments!['en-us'][a].choices &&
                                        command.arguments!['en-us'][a].choices.length > 0
                                    ) {
                                        if (command.arguments!['en-us'][a].choices) {
                                            for (let c in command.arguments!['en-us'][a].choices) {
                                                const choice = command.arguments!['en-us'][a].choices![c];

                                                const choiceNameLocalizations = {};

                                                for (let language of Object.keys(command.arguments!)) {
                                                    const filteredLang = languageFilter(language);
                                                    const choices = command.arguments![language][a].choices;
                                                    if (choices) {
                                                        const matchingChoice = choices.find(
                                                            c => c.return === choice.return
                                                        );
                                                        if (matchingChoice) {
                                                            choiceNameLocalizations[filteredLang] = matchingChoice.name;
                                                        }
                                                    }
                                                }

                                                option.addChoices({
                                                    name: command.arguments!['en-us'][a].choices![c].name,
                                                    value: `${command.arguments!['en-us'][a].choices![c].return}`,
                                                    name_localizations: choiceNameLocalizations
                                                });
                                            }
                                        }
                                    } else if (command.arguments!['en-us'][a].autocomplete) {
                                        option.setAutocomplete(command.arguments!['en-us'][a].autocomplete);
                                    }

                                    return option;
                                });
                            }
                            //@ts-ignore
                            else if (command.arguments['en-us'][a].type == 'INTEGER') {
                                newCommand.addIntegerOption((option: SlashCommandIntegerOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setAutocomplete(command.arguments!['en-us'][a].autocomplete)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    return option;
                                });
                            }
                            //@ts-ignore
                            else if (command.arguments['en-us'][a].type == 'USER') {
                                newCommand.addUserOption((option: SlashCommandUserOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    return option;
                                });
                            }
                            //@ts-ignore
                            else if (command.arguments['en-us'][a].type == 'ATTACHMENT') {
                                newCommand.addAttachmentOption((option: SlashCommandAttachmentOption) => {
                                    option
                                        .setName(command.arguments!['en-us'][a].name)
                                        .setDescription(command.arguments!['en-us'][a].description)
                                        .setRequired(command.arguments!['en-us'][a].required)
                                        .setNameLocalizations(localizedArgsNames[command.arguments!['en-us'][a].name])
                                        .setDescriptionLocalizations(
                                            localizedArgsDescriptions[command.arguments!['en-us'][a].name]
                                        );

                                    return option;
                                });
                            }
                        }
                    }

                    // if (command.options) {
                    //     const localizedOptionsNames: any = {};
                    //     const localizedOptionsDescriptions: any = {};

                    //     for (let i = 0; i < Object.keys(command.options['en-us']).length; i++) {
                    //         const argEn = command.options['en-us'][i].name;

                    //         for (let language of Object.keys(command.options)) {
                    //             const arg = command.options[language][i];

                    //             language = languageFilter(language);

                    //             if (!localizedOptionsNames[argEn]) {
                    //                 localizedOptionsNames[argEn] = {};
                    //             }

                    //             if (!localizedOptionsDescriptions[argEn]) {
                    //                 localizedOptionsDescriptions[argEn] = {};
                    //             }

                    //             localizedOptionsNames[argEn][language] = arg.name;
                    //             localizedOptionsDescriptions[argEn][language] = arg.description;
                    //         }
                    //     }

                    //     const localizedOptionsChoicesNames: any = {};

                    //     for (let i = 0; i < Object.keys(command.options['en-us']).length; i++) {
                    //         const argEn = command.options['en-us'][i].name;

                    //         for (let language of Object.keys(command.options)) {
                    //             const arg = command.options[language][i];

                    //             language = languageFilter(language);

                    //             if (!localizedOptionsChoicesNames[argEn]) {
                    //                 localizedOptionsChoicesNames[argEn] = {};
                    //             }

                    //             localizedOptionsChoicesNames[argEn][language] = {};

                    //             if (arg.choices) {
                    //                 for (let c in arg.choices) {
                    //                     localizedOptionsChoicesNames[argEn][language][arg.choices[c].return] =
                    //                         arg.choices[c].name;
                    //                 }
                    //             }
                    //         }
                    //     }

                    //     for (let o in command.options['en-us']) {
                    //         if (command.options['en-us'][o].type == 'STRING') {
                    //             newCommand.addStringOption((option: SlashCommandStringOption) => {
                    //                 option
                    //                     .setName(command.options!['en-us'][o].name)
                    //                     .setDescription(command.options!['en-us'][o].description)
                    //                     .setRequired(command.options!['en-us'][o].required)
                    //                     .setNameLocalizations(localizedOptionsNames[command.options!['en-us'][o].name])
                    //                     .setDescriptionLocalizations(
                    //                         localizedOptionsDescriptions[command.options!['en-us'][o].name]
                    //                     );

                    //                 if (command.options!['en-us'][o].choices) {
                    //                     for (let c in command.options!['en-us'][o].choices) {
                    //                         const optionName = command.options!['en-us'][o].name;
                    //                         const choice = command.options!['en-us'][o].choices[c];

                    //                         const choiceNameLocalizations = {};

                    //                         for (let language in localizedOptionsChoicesNames[optionName]) {
                    //                             choiceNameLocalizations[language] =
                    //                                 localizedOptionsChoicesNames[optionName][language][choice.return];
                    //                         }

                    //                         option.addChoices({
                    //                             name: command.options!['en-us'][o].choices[c].name,
                    //                             value: `${command.options!['en-us'][o].choices[c].return}`,
                    //                             name_localizations: choiceNameLocalizations
                    //                         });
                    //                     }
                    //                 }

                    //                 return option;
                    //             });
                    //         }
                    //     }
                    // }

                    commands.push(newCommand);
                }
            } else if (command.type == 3) {
                const newCommand = new ContextMenuCommandBuilder();

                if (command.ownerOnly) {
                    newCommand.setDefaultMemberPermissions('0');
                    newCommand.setName(command.commandNames['en-us']);
                    newCommand.setType(command.type);

                    // apply name localizations for ownerOnly context menu commands
                    for (let language in command.commandNames) {
                        const name = command.commandNames[language];
                        const filteredLang = languageFilter(language);

                        if (!Object.values(Locale).includes(filteredLang as Locale)) {
                            throw new Error(`Invalid language: ${filteredLang}`);
                        } else {
                            //@ts-ignore
                            newCommand.setNameLocalization(filteredLang as Locale, name);
                        }
                    }

                    commandsOwnerOnly.push(newCommand);
                } else {
                    newCommand.setDefaultMemberPermissions(null);
                    newCommand.setName(command.commandNames['en-us']);
                    newCommand.setType(command.type);
                    newCommand.setIntegrationTypes([
                        ApplicationIntegrationType.GuildInstall,
                        ApplicationIntegrationType.UserInstall
                    ]);
                    newCommand.setContexts([
                        InteractionContextType.Guild,
                        InteractionContextType.BotDM,
                        InteractionContextType.PrivateChannel
                    ]);

                    for (let language in command.commandNames) {
                        const name = command.commandNames[language];

                        language = languageFilter(language);

                        if (!Object.values(Locale).includes(language as Locale)) {
                            throw new Error(`Invalid language: ${language}`);
                        } else {
                            //@ts-ignore
                            newCommand.setNameLocalization(language, name);
                        }
                    }

                    commands.push(newCommand);
                }
            }
        });

        try {
            await rest.put(Routes.applicationCommands(int.application_id), { body: commands });
        } catch (err) {
            logger.error(err, { event: 'commands.reload_failed', action: 'global' });
            return int.reply({ content: 'Erro ao recarregar os comandos' });
        }

        try {
            await rest.put(Routes.applicationGuildCommands(int.application_id, '717173630110400515'), {
                body: commandsOwnerOnly
            });
        } catch (err) {
            logger.error(err, { event: 'commands.reload_failed', action: 'owner_only' });
            return int.reply({ content: 'Erro ao recarregar os comandos ownerOnly' });
        }

        int.reply({ content: 'Comandos recarregados' });
    }
};
