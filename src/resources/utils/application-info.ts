import rest from '../../configs/rest';
import { Routes, Snowflake } from 'discord-api-types/v10';

let applicationInfo: {
    approximate_guild_count: number;
    bot: {
        id: Snowflake;
        username: string;
        discriminator: string;
        avatar: string;
        public_flags: number;
        flags: number;
        bot: boolean;
        banner: string;
        accent_color: number;
        global_name: string;
        avatar_decoration_data: string;
        banner_color: string;
        clan: string;
    };
};

async function getApplicationInfo() {
    const applicationInfo = await rest.get(Routes.currentApplication(), {
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        }
    });

    return applicationInfo;
}

getApplicationInfo()
    .then(info => {
        // @ts-ignore
        applicationInfo = info;
    })
    .catch(() => {
        // Em testes ou sem rede, mantém applicationInfo indefinido sem derrubar o import.
    });

if (process.env.NODE_ENV !== 'test') {
    const interval = setInterval(
        async () => {
            try {
                // @ts-ignore
                applicationInfo = await getApplicationInfo();
            } catch {
                // ignora falhas periódicas de rede
            }
        },
        1000 * 60 * 60 * 12
    );
    // Não segura o processo aberto (importante p/ testes com --detectOpenHandles).
    (interval as unknown as { unref?: () => void }).unref?.();
}

export { applicationInfo, getApplicationInfo };
