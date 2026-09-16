import { EmbedBuilder, ButtonBuilder } from '@discordjs/builders';
import os from 'os-utils';
import process from 'node:process';
import { Interaction } from '../../resources/utils/interaction-handler';
import config from '../../configs/config';
import { localization } from '../../resources/localization';
import db from '../../configs/database';
import { applicationInfo } from '../../resources/utils/application-info';
import commandsStatistics from '../../resources/utils/command-statistics';
import { Command_Category } from '../../types/enums';
import botStatus from '../../modules/bot-status';

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'botinfo',
        'en-us': 'botinfo'
    },
    fullNames: {
        'pt-br': 'Botinfo',
        'en-us': 'Botinfo'
    },
    descriptions: {
        'pt-br': 'Mostra estatísticas sobre o bot.',
        'en-us': 'Shows statistics about the bot.'
    },
    type: 1,
    category: Command_Category.GENERAL,
    run: async (int: Interaction, language: Available_Languages) => {
        const ping = new Date().getTime() - int.createdTimestamp;

        const botInfoEmbed = new EmbedBuilder();
        botInfoEmbed.setColor(parseInt(config.EMBED_COLOR));
        botInfoEmbed.setTitle(localization(language, 'bot-info|title'));

        const stats = botStatus!.getProcessStats();

        const cpuUsage = stats.cpu;
        const memoryUsage = stats.memory.toFixed(2);
        const totalMemory = os.totalmem() / 1024;
        const freeMemory = os.freemem() / 1024;

        let dbPing = Date.now();
        await db.$queryRaw`SELECT 1`;
        dbPing = Date.now() - dbPing;

        let serverCount = applicationInfo.approximate_guild_count;

        let uptime = process.uptime();

        let days = Math.floor((uptime % 31536000) / 86400);
        let hours = Math.floor((uptime % 86400) / 3600);
        let minutes = Math.floor((uptime % 3600) / 60);
        let seconds = Math.round(uptime % 60);

        let uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;

        const totalTextCommands = await commandsStatistics.getTotalCount('COMMAND');
        const totalButtonCommands = await commandsStatistics.getTotalCount('COMPONENT');

        const totalTextCommandsSince = await commandsStatistics.getTotalCountSince(undefined, undefined, 'COMMAND');
        const totalButtonCommandsSince = await commandsStatistics.getTotalCountSince(undefined, undefined, 'COMPONENT');

        botInfoEmbed.addFields([
            { name: localization(language, 'bot-info|cpu-usage'), value: `\`${cpuUsage} %\``, inline: true },
            { name: localization(language, 'bot-info|memory-usage'), value: `\`${memoryUsage} MB\``, inline: true },
            {
                name: localization(language, 'bot-info|total-memory'),
                value: `\`${(totalMemory - freeMemory).toFixed(1)} GB / ${totalMemory.toFixed(1)} GB\``,
                inline: true
            },
            {
                name: localization(language, 'bot-info|ping'),
                value: `\`BOT: ${ping} ms - DB: ${Math.round(dbPing)} ms\``,
                inline: false
            },
            {
                name: localization(language, 'bot-info|command-count'),
                value: `\`${localization(language, 'bot-info|command-count-value', [
                    { replace: '$slash$', value: totalTextCommands },
                    { replace: '$button$', value: totalButtonCommands }
                ])}\``,
                inline: false
            },
            {
                name: localization(language, 'bot-info|command-count-last-24-hours'),
                value: `\`${localization(language, 'bot-info|command-count-value', [
                    { replace: '$slash$', value: totalTextCommandsSince! },
                    { replace: '$button$', value: totalButtonCommandsSince! }
                ])}\``,
                inline: false
            },
            { name: localization(language, 'bot-info|server-count'), value: `\`${serverCount}\``, inline: true },
            { name: localization(language, 'bot-info|uptime'), value: `\`${uptimeString}\``, inline: true }
        ]);

        botInfoEmbed.setTimestamp(Date.now());
        botInfoEmbed.setFooter({
            text: localization(language, 'embed|footer', [
                { replace: '$version$', value: config.VERSION },
                { replace: '$year$', value: new Date().getFullYear().toString() }
            ])
        });

        const supportButton = new ButtonBuilder()
            .setStyle(5)
            .setLabel(localization(language, 'bot-info|support-button'))
            .setURL('https://kamicom.br/suporte');

        const inviteButton = new ButtonBuilder()
            .setStyle(5)
            .setLabel(localization(language, 'bot-info|invite-button'))
            .setURL('https://kamicom.br/convite');

        await int.reply({
            embeds: [botInfoEmbed],
            components: [{ type: 1, components: [supportButton, inviteButton] }]
        });
    }
};
