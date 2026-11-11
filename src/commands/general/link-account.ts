import { Interaction } from '../../resources/utils/interaction-handler';
import { localization } from '../../resources/localization';
import config from '../../configs/config';
import { Command_Category } from '../../types/enums';

export default {
    ownerOnly: false,
    commandNames: {
        'pt-br': 'vincular',
        'en-us': 'link_account'
    },
    fullNames: {
        'pt-br': 'Vincular conta',
        'en-us': 'Link account'
    },
    descriptions: {
        'pt-br': 'Vincula sua conta do site à sua conta do Discord.',
        'en-us': 'Links your website account to your Discord account.'
    },
    arguments: {
        'pt-br': [
            {
                name: 'codigo',
                description: 'Código exibido nas configurações do site.',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ],
        'en-us': [
            {
                name: 'code',
                description: 'Code shown in the website settings.',
                type: 'STRING',
                required: true,
                autocomplete: false
            }
        ]
    },
    type: 1,
    category: Command_Category.GENERAL,
    doNotAcknowledge: true,
    run: async (int: Interaction, language: Available_Languages) => {
        await int.acknowledge(true);

        if (!config.BOT_SYNC_TOKEN) {
            return int.reply({ content: localization(language, 'link-account|unavailable') });
        }

        const code = int.getArgs().get('code')?.value || int.getArgs().get('codigo')?.value;

        if (!code) {
            return int.reply({ content: localization(language, 'link-account|invalid-code') });
        }

        try {
            const response = await fetch(`${config.KAMI_SITE_URL}/api/internal/discord/claim`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-kami-service-token': config.BOT_SYNC_TOKEN
                },
                body: JSON.stringify({
                    code,
                    discordId: int.user.id,
                    discordUsername: int.user.username
                }),
                signal: AbortSignal.timeout(20_000)
            });

            if (!response.ok) {
                const body = (await response.json().catch(() => null)) as { code?: string } | null;
                const key =
                    body?.code === 'discord_code_invalid' ? 'link-account|invalid-code' : 'link-account|unavailable';

                return int.reply({ content: localization(language, key) });
            }

            const body = (await response.json()) as { siteUsername?: string };

            return int.reply({
                content: localization(language, 'link-account|claimed', [
                    {
                        replace: '$username$',
                        value: body.siteUsername ?? 'Kami'
                    }
                ])
            });
        } catch {
            return int.reply({ content: localization(language, 'link-account|unavailable') });
        }
    }
};
