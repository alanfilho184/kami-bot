import { EmbedBuilder, ButtonBuilder } from '@discordjs/builders';
import { diceRoller, formatDiceEmbedOutput, validateDiceString } from '../../resources/utils/dice-roller';
import { d1_100 } from '../../resources/assets/assets';
import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import config from '../../configs/config';
import { ButtonStyle } from 'discord-api-types/v10';
import { Command_Category } from '../../types/enums';

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'roll',
        'en-us': 'roll'
    },
    fullNames: {
        'pt-br': 'Roll',
        'en-us': 'Roll'
    },
    descriptions: {
        'pt-br': 'Rola um dado (ex: 1d20).',
        'en-us': 'Rolls a dice (ex: 1d20).'
    },
    arguments: {
        'pt-br': [
            {
                name: 'dado',
                description: 'O dado a ser rolado (ex: 3d6).',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ],
        'en-us': [
            {
                name: 'dice',
                description: 'The dice to be rolled (ex: 3d6).',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ]
    },
    type: 1,
    category: Command_Category.ROLL,
    run: async (int: Interaction, language: Available_Languages) => {
        let dice: string | null = null;

        if (int.isMessageComponent()) {
            dice = int.component!.args;
        } else {
            dice = int.getArgs().get('dice').value;
            dice = dice!.replace(/\s/g, '');
        }

        if (!dice) {
            return int.reply({ content: localization(language, 'roll|invalid-dice') });
        }

        if (dice.match(/^\d+$/gi)) {
            dice = '1d' + dice;
        }

        try {
            if (!validateDiceString(dice)) {
                return int.reply({ content: localization(language, 'roll|invalid-dice') });
            }
        } catch (error) {
            return int.reply({ content: localization(language, 'roll|invalid-dice') });
        }
        
        let diceResult;

        try {
            diceResult = diceRoller(dice);
        } catch (err) {
            return int.reply({ content: localization(language, 'roll|invalid-dice') });
        }

        let diceEmbed = formatDiceEmbedOutput(diceResult);

        diceEmbed.setTitle(
            localization(language, 'roll|title', [
                { replace: '$user$', value: int.user.preferred_nick },
                { replace: '$dice$', value: dice }
            ])
        );

        diceEmbed.setColor(parseInt(config.EMBED_COLOR));
        diceEmbed.setTimestamp(Date.now());
        diceEmbed.setFooter({
            text: localization(language, 'embed|footer', [
                { replace: '$version$', value: config.VERSION },
                { replace: '$year$', value: new Date().getFullYear().toString() }
            ])
        });

        const finalResult = diceResult.final;

        if (finalResult <= 100 && finalResult > 0) {
            diceEmbed.setThumbnail(d1_100[finalResult]);
        }

        const rollAgainButton = new ButtonBuilder();
        rollAgainButton.setCustomId('roll-again|' + dice);
        rollAgainButton.setLabel(localization(language, 'roll|roll-again'));
        rollAgainButton.setStyle(ButtonStyle.Primary);

        await int.reply({
            embeds: [diceEmbed],
            components: [{ type: 1, components: [rollAgainButton] }]
        });
    }
};
