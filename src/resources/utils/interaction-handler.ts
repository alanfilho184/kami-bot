import { InteractionResponseType, InteractionType, InteractionResponseFlags } from 'discord-interactions';
import { Routes, Snowflake, Locale } from 'discord-api-types/v10';
import { Available_Languages } from '../../types/enums';
import { Response } from 'express';
import rest from '../../configs/rest';
import logger from '../../configs/logger';
import { users_config } from '@prisma/client';
import UserController from '../../controllers/user.controller';
import { performance } from 'node:perf_hooks';

const DISCORD_EPOCH = 1420070400000;

class Interaction {
    app_permissions: Snowflake;
    application_id: Snowflake;
    authorizing_integration_owners: Record<string, Snowflake>;
    channel: {
        id: Snowflake;
        type: number;
        name?: string;
        recipients: {
            avatar: string;
            discriminator: string;
            id: Snowflake;
            public_flags: number;
            global_name: string;
            username: string;
        }[];
    };
    channel_id: Snowflake;
    context: number;
    data: {
        id: Snowflake;
        name: string;
        type: number;
        options?: {
            name: string;
            type: number;
            value: string;
            focused?: boolean;
        }[];
        component_type?: number;
        custom_id?: string;
        values?: string[];
    };
    guild: {
        id: Snowflake;
        locale: Locale;
        features: string[];
    };
    guild_id: Snowflake;
    guild_locale: Locale;
    id: Snowflake;
    locale: Locale;
    member: {
        deaf: boolean;
        pending: boolean;
        permissions: Snowflake;
        roles: Snowflake[];
        user: {
            avatar: string;
            avatar_decoration_data: string | null;
            clan: string | null;
            discriminator: string;
            global_name: string;
            id: Snowflake;
            public_flags: number;
            username: string;
            system?: boolean;
            bot?: boolean;
        };
        nick?: string;
    };
    createdTimestamp: number;
    token: string;
    type: InteractionType;
    version: number;
    language: Available_Languages;
    user: {
        id: Snowflake;
        username: string;
        avatar?: string;
        global_name: string;
        public_flags: number;
        preferred_nick: string;
        system?: boolean;
        bot?: boolean;
    };
    kami_user?: User & users_config;
    component?: {
        type: number;
        name: string;
        args: string;
    };
    res: Pick<Response, 'json'>;
    private commandStartedAt: number | null = null;
    constructor(interaction: Interaction, res: Response) {
        this.app_permissions = interaction.app_permissions;
        this.application_id = interaction.application_id;
        this.authorizing_integration_owners = interaction.authorizing_integration_owners ?? {};
        this.channel = interaction.channel;
        this.channel_id = interaction.channel_id;
        this.context = interaction.context;
        this.data = interaction.data;
        this.guild = interaction.guild;
        this.guild_id = interaction.guild_id;
        this.guild_locale = interaction.guild_locale;
        this.id = interaction.id;
        this.locale = interaction.locale;
        this.member = interaction.member;
        this.createdTimestamp = Number(BigInt(this.id) >> 22n) + DISCORD_EPOCH;
        this.token = interaction.token;
        this.type = interaction.type;
        this.version = interaction.version;
        this.res = {
            json: res.json.bind(res)
        };

        if (interaction.type !== InteractionType.PING) {
            this.language = this.getLanguage();
        } else {
            this.language = Available_Languages['en-us'];
        }

        if (this.inGuild()) {
            // @ts-ignore
            this.user = this.member.user;
            if (this.member.nick) {
                this.user.preferred_nick = this.member.nick;
            } else {
                this.user.preferred_nick = this.user.global_name || this.user.username;
            }
        } else {
            try {
                this.user = interaction.user;
                this.user.preferred_nick = this.user.global_name || this.user.username;
            } catch (err) {
                this.user = {
                    id: '0',
                    username: 'Unknown',
                    global_name: 'Unknown',
                    public_flags: 0,
                    preferred_nick: 'Unknown'
                };

                throw new Error('Unknown user');
            }
        }

        if (this.type === InteractionType.MESSAGE_COMPONENT) {
            this.component = {
                type: interaction.data.component_type!,
                name: interaction.data.custom_id!.split('|')[0],
                args: interaction.data.custom_id!.split('|')[1]
            };
        }
    }

    startCommandTimer(): void {
        this.commandStartedAt = performance.now();
    }

    stopCommandTimer(): number | null {
        if (this.commandStartedAt === null) {
            return null;
        }

        const executionMs = Math.round(performance.now() - this.commandStartedAt);
        this.commandStartedAt = null;
        return executionMs;
    }

    async loadUser() {
        let user = await UserController.getByDiscordId(this.user.id);

        if (!user) {
            const newUser = await UserController.create({
                discord_id: this.user.id,
                email: null,
                password: null,
                username: this.user.preferred_nick,
                avatar: this.user.avatar
            });

            user = newUser as User & users_config;
        }

        this.kami_user = {
            id: user.id,
            discord_id: user.discord_id,
            username: user.username || this.user.preferred_nick,
            avatar: user.avatar || this.user.avatar,
            email: user.email || '',
            password: '',
            has_site_account: user.has_site_account === true,
            is_beta: user.is_beta,
            is_premium: user.is_premium,
            last_use: user.last_use,
            //@ts-ignore
            language: user.language || null,
            secret_general: user.secret_general || false,
            secret_insan: user.secret_insan || false,
            secret_roll: user.secret_roll || false,
            secret_send: user.secret_send || false,
            secret_sheet: user.secret_sheet || false
        };

        if (this.kami_user?.language) {
            //@ts-ignore
            this.language = `${this.kami_user.language}`.toLowerCase().replace('_', '-') as Available_Languages;
        } else {
            this.language = this.getLanguage();
        }

        UserController.updateLastUseById(user.id);
    }

    async acknowledge(ephemeral?: boolean) {
        if (!this.isAutocomplete()) {
            if (this.data.custom_id && this.data.custom_id.startsWith('$a$')) {
                await this.res.json({
                    type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE
                });
            } else {
                await this.res.json({
                    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        flags: ephemeral ? InteractionResponseFlags.EPHEMERAL : undefined
                    }
                });
            }
        } else {
            throw new Error('This interaction is an autocomplete interaction.');
        }
    }

    async reply(data: Message_Data) {
        if (!this.isAutocomplete()) {
            const msg = await rest.patch(Routes.webhookMessage(this.application_id, this.token, '@original'), {
                body: {
                    ...data
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return msg;
        } else {
            throw new Error('This interaction is an autocomplete interaction.');
        }
    }

    async followUp(data: Message_Data) {
        if (!this.isAutocomplete()) {
            const msg = await rest.post(`/webhooks/${this.application_id}/${this.token}`, {
                body: {
                    ...data
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return msg;
        } else {
            throw new Error('This interaction is an autocomplete interaction.');
        }
    }

    async autocomplete(data: { name: string; value: string }[]) {
        if (this.isAutocomplete()) {
            this.res.json({
                type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
                data: {
                    choices: data
                }
            });
        } else {
            throw new Error('This interaction is not an autocomplete interaction.');
        }
    }

    inGuild() {
        return this.guild_id !== undefined;
    }

    inDM() {
        return this.guild_id === undefined;
    }

    hasGuildInstall() {
        const owners = this.authorizing_integration_owners;

        if (owners && Object.keys(owners).length > 0) {
            return Boolean(owners['0']);
        }

        return this.inGuild();
    }

    isMessageComponent() {
        return this.type === InteractionType.MESSAGE_COMPONENT;
    }

    isCommand() {
        return this.type === InteractionType.APPLICATION_COMMAND;
    }

    isAutocomplete() {
        return this.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE;
    }

    isPing() {
        return this.type === InteractionType.PING;
    }

    private getLanguage() {
        try {
            let languageStr =
                this.inGuild() === true && this.guild_locale !== null
                    ? `${this.guild_locale}`.toLowerCase().replace('_', '-')
                    : `${this.locale}`.toLowerCase().replace('_', '-');

            if (Object.values(Available_Languages).includes(languageStr as Available_Languages)) {
                return languageStr as Available_Languages;
            }

            return Available_Languages['en-us'];
        } catch (err) {
            logger.error(err, { event: 'language.resolve_error' });
            return Available_Languages['en-us'];
        }
    }

    getArgs() {
        if (this.isCommand() || this.isAutocomplete()) {
            const args: Map<string, { name: string; type: number; value: string; focused?: boolean }> = new Map();

            if (this.data.options) {
                for (const option of this.data.options) {
                    args.set(option.name, option);
                }
            }

            return args;
        } else {
            return new Map();
        }
    }
}

export { Interaction };
