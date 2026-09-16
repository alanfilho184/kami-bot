import { EmbedBuilder } from '@discordjs/builders';
import config from '../configs/config';
import rest from '../configs/rest';
import { Routes } from 'discord-api-types/v10';
import { DateTime } from 'luxon';

async function sendCommandWebhook(content: EmbedBuilder) {
    await rest.post(Routes.webhook(config.COMMAND_WEBHOOK_ID.discord_id, config.COMMAND_WEBHOOK_TOKEN), {
        body: {
            embeds: [content]
        }
    });
}

async function sendLogWebhook(content: string | EmbedBuilder | EmbedBuilder[], ping?: boolean) {
    const body: any = {};
    if (content instanceof EmbedBuilder) {
        body.content = ping ? `<@${config.OWNER_ID.discord_id}>` : '';
        body.embeds = [content];
    } else if (Array.isArray(content) && content.every(embed => embed instanceof EmbedBuilder)) {
        body.content = ping ? `<@${config.OWNER_ID}>` : '';
        body.embeds = content;
    } else if (typeof content == 'string') {
        body.content = content;
    }

    await rest.post(Routes.webhook(config.LOG_WEBHOOK_ID.discord_id, config.LOG_WEBHOOK_TOKEN), {
        body: body
    });
}

async function sendStartupWebhook() {
    const content = new EmbedBuilder()
        .setColor(parseInt(config.EMBED_COLOR))
        .setTitle(`${config.INSTANCE_TYPE} instance started`)
        .setFooter({
            text: `Kami v${config.VERSION} | ${DateTime.now()
                .setZone('America/Sao_Paulo')
                .toFormat('dd/MM/y | HH:mm:ss ')} (GMT -3)`
        });

    await sendLogWebhook(content);
}

export { sendCommandWebhook, sendLogWebhook, sendStartupWebhook };
