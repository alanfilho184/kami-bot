import { EmbedBuilder } from '@discordjs/builders';
import db from '../../configs/database';
import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import config from '../../configs/config';
import { diceRoller } from '../../resources/utils/dice-roller';
import { Command_Category, Available_Languages } from '../../types/enums';

function deDuplicateRolls(rolls: number[], diceSize: number): number[] {
    const uniqueRolls = new Set<number>();

    rolls.forEach(roll => {
        uniqueRolls.add(roll);
    });

    while (uniqueRolls.size != rolls.length) {
        uniqueRolls.add(diceRoller(`1d${diceSize}`).results[0]);
    }

    return Array.from(uniqueRolls);
}

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'insanidade',
        'en-us': 'insanity'
    },
    fullNames: {
        'pt-br': 'Insanidade',
        'en-us': 'Insanity'
    },
    descriptions: {
        'pt-br': 'Envia uma insanidade para um personagem, temporaria ou permanente.',
        'en-us': 'Sends an insanity to a character, temporary or permanent.'
    },
    arguments: {
        'pt-br': [
            {
                name: 'tipo',
                description: 'O tipo de insanidade (temporaria ou permanente).',
                type: 'STRING',
                required: true,
                choices: [
                    {
                        name: 'Temporaria',
                        return: 'temporary'
                    },
                    {
                        name: 'Permanente',
                        return: 'permanent'
                    }
                ]
            }
        ],
        'en-us': [
            {
                name: 'type',
                description: 'The type of insanity (temporary or permanent).',
                type: 'STRING',
                required: true,
                choices: [
                    {
                        name: 'Temporary',
                        return: 'temporary'
                    },
                    {
                        name: 'Permanent',
                        return: 'permanent'
                    }
                ]
            }
        ]
    },
    type: 1,
    category: Command_Category.INSANITY,
    run: async (int: Interaction, language: Available_Languages) => {
        const type = int.getArgs().get('type').value;

        const insanityEmbed = new EmbedBuilder()
            .setColor(parseInt(config.EMBED_COLOR))
            .setTimestamp()
            .setFooter({
                text: localization(language, 'embed|footer', [
                    { replace: '$version$', value: config.VERSION },
                    { replace: '$year$', value: new Date().getFullYear().toString() }
                ])
            });
        if (type === 'temporary') {
            insanityEmbed.setTitle(localization(language, 'insanity|temporary-title'));

            const temporaryInsanities = (
                await db.resources.findFirst({
                    where: {
                        AND: [
                            {
                                name: 'temporary_insanity'
                            },
                            {
                                language: language == Available_Languages['pt-br'] ? 'PT_BR' : 'EN_US'
                            }
                        ]
                    },
                    select: {
                        data: true
                    }
                })
            )?.data! as string[];

            const roll = diceRoller(`1d${temporaryInsanities.length}`);

            const insanitys: string[] = [];
            if (roll.results[0] == 1) {
                const positionRoll = deDuplicateRolls(
                    diceRoller(`3d${temporaryInsanities.length}`).results,
                    temporaryInsanities.length
                );

                for (let i = 0; i < 3; i++) {
                    insanitys.push(temporaryInsanities[positionRoll[i] - 1]);
                }

                insanityEmbed.setDescription(
                    localization(language, 'insanity|temporary-description', [
                        { replace: '$insanity$', value: insanitys[0] },
                        { replace: '$insanity2$', value: insanitys[1] },
                        { replace: '$insanity3$', value: insanitys[2] }
                    ])
                );
            } else if (roll.results[0] == 2) {
                const positionRoll = deDuplicateRolls(
                    diceRoller(`2d${temporaryInsanities.length}`).results,
                    temporaryInsanities.length
                );

                for (let i = 0; i < 2; i++) {
                    insanitys.push(temporaryInsanities[positionRoll[i] - 1]);
                }

                insanityEmbed.setDescription(
                    localization(language, 'insanity|temporary-description', [
                        { replace: '$insanity$', value: insanitys[0] },
                        { replace: '$insanity2$', value: insanitys[1] }
                    ])
                );
            } else {
                insanityEmbed.setDescription(
                    localization(language, 'insanity|temporary-description', [
                        { replace: '$insanity$', value: temporaryInsanities[roll.results[0] - 1] }
                    ])
                );
            }
        } else if (type === 'permanent') {
            insanityEmbed.setTitle(localization(language, 'insanity|permanent-title'));

            const permanentInsanities = (
                await db.resources.findFirst({
                    where: {
                        AND: [
                            {
                                name: 'permanent_insanity'
                            },
                            {
                                language: language == Available_Languages['pt-br'] ? 'PT_BR' : 'EN_US'
                            }
                        ]
                    },
                    select: {
                        data: true
                    }
                })
            )?.data! as string[];

            const roll = diceRoller(`1d${permanentInsanities.length}`);

            insanityEmbed.setDescription(
                localization(language, 'insanity|permanent-description', [
                    { replace: '$insanity$', value: permanentInsanities[roll.results[0] - 1] }
                ])
            );
        }

        return int.reply({
            embeds: [insanityEmbed]
        });
    }
};
