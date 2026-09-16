import * as validations from './validations.ts';
import { PrismaClient, users } from '@prisma/client';
import type { Buffer } from 'node:buffer';
import { ComponentBuilder, EmbedBuilder } from '@discordjs/builders';
import { Snowflake, TextChannelType, Locale } from 'discord-api-types/v10';
import { Interaction } from '../resources/utils/interaction-handler.js';
import { ActionRow } from 'discord-interactions';
import { DateTime } from 'luxon';

export {};

declare global {
    type EnvVars = {
        NODE_ENV: 'development' | 'production' | 'test';
        DATABASE_URL: string;
        PORT: number;
        BOT_TOKEN: string;
        PUBLIC_KEY: string;
        CLIENT_ID: Discord_Id;
        CLIENT_SECRET: string;
        OWNER_ID: Discord_Id;
        LOG_CHANNEL_ID: Channel_Id;
        COMMAND_WEBHOOK_ID: Discord_Id;
        COMMAND_WEBHOOK_TOKEN: string;
        LOG_WEBHOOK_ID: Discord_Id;
        LOG_WEBHOOK_TOKEN: string;
        BOT_STATUS_CHANNEL_ID: Channel_Id;
        BOT_STATUS_MESSAGE_ID: Msg_Id;
        EMBED_COLOR: string;
        VERSION: string;
        API_TOKEN: string;
        INSTANCE_TYPE: 'primary' | 'backup';
        PRIMARY_INSTANCE_STATUS_URL?: string;
        PRIMARY_API_TOKEN?: string;
    };

    interface Logger {
        logFile: string;
        logHttp(req: Express.Request, res: Express.Response, responseBody: unknown): void;
        logText(level: 'INFO' | 'WARN' | 'ERROR', message: unknown, automated?: boolean): void;
        logDiscord(int: Interaction): void;
        getLog(date: DateTime): string | false;
    }

    type Db = PrismaClient;

    enum Command_Category {
        GENERAL = 'GENERAL',
        INSANITY = 'INSANITY',
        ROLL = 'ROLL',
        SHEET_ALTER = 'SHEET_ALTER',
        SHEET_SEND = 'SHEET_SEND',
        OWNER_ONLY = 'OWNER_ONLY'
    }

    type Command = {
        ownerOnly: boolean;
        subCommandOf?: string;
        commandNames: {
            [language: string]: string;
        };
        fullNames: {
            [language: string]: string;
        };
        descriptions: {
            [language: string]: string;
        };
        arguments?: {
            [language: string]: [
                {
                    name: string;
                    description: string;
                    type: 'STRING';
                    required: boolean;
                    autocomplete: boolean;
                    choices?: [{ name: string; return: string | number }];
                }
            ];
        };
        type: number;
        category: Command_Category;
        doNotAcknowledge?: boolean;
        run: (interaction: Interaction, language: Available_Languages) => Promise<void>;
        autocomplete?: (interaction: Interaction, language: Available_Languages) => Promise<void>;
    };

    type Component = {
        name: string;
        ownerOnly: boolean;
        category: Command_Category;
        doNotAcknowledge?: boolean;
        run: (interaction: Interaction, language: Available_Languages) => Promise<void>;
    };

    type Localization = (
        language: Available_Languages,
        key: string,
        replaces?: { replace: string; value: string | number }[]
    ) => string;

    enum Ban_Type {
        TEMPORARY = 'TEMPORARY',
        PERMANENT = 'PERMANENT',
        UNBANNED = 'UNBANNED'
    }

    enum Available_Languages {
        'pt-br' = 'pt-br',
        'en-us' = 'en-us'
    }

    enum Section_Type {
        STANDARD = 0,
        DESCRIPTION = 1
    }

    enum Attribute_Type {
        TEXT = 0,
        NUMBER = 1,
        IMAGE = 2,
        LIST = 3,
        BAR = 4
    }

    enum Macro_Type {
        NORMAL = 0,
        MODIFIER_PLUS = 1,
        MODIFIER_MINUS = 2
    }

    enum Announcement_Mode {
        ALWAYS = 'ALWAYS',
        ONCE = 'ONCE',
        INTERVAL = 'INTERVAL'
    }

    type Discord_Id = validations.Discord_Id;
    type Server_Id = validations.Server_Id;
    type Msg_Id = validations.Msg_Id;
    type Channel_Id = validations.Channel_Id;
    type Sheet_Name = validations.Sheet_Name;
    type Macro_Name = validations.Macro_Name;

    type User = {
        id: number;
        discord_id?: Discord_Id;
        username: string;
        avatar?: string;
        email: string;
        password: string;
        is_beta: boolean;
        is_premium: boolean;
        last_use: Date;
    };

    type Blocked_User = {
        id: number;
        user_id: number;
        ban_count: number;
        actual_ban: Ban_Type;
        ban_duration: Date;
    };

    type Irt_Sheet = {
        id: number;
        user_id: number;
        sheet_id: number;
        msg_id: Msg_Id;
        channel_id: Channel_Id;
    };

    type Server_Config = {
        id: number;
        server_id: Server_Id;
        language: Available_Languages;
        force_language: boolean;
    };

    type Attribute = {
        name: string;
        position: number;
        type: Attribute_Type;
        value: string | number;
        config?: {
            width?: number;
            height?: number;
            max?: number;
            min?: number;
            step?: number;
            max_length?: number;
            min_length?: number;
        };
    };

    type Sheet = {
        id: number;
        user_id: number;
        user?: {
            id: number;
            username: string;
            avatar?: string;
            is_beta: boolean;
            is_premium: boolean;
        };
        sheet_name: string;
        sheet_password: string;
        is_public: boolean;
        attributes: {
            sections: [
                {
                    name: string;
                    position: number;
                    type: Section_Type;
                    attributes: Attribute[];
                }
            ];
        };
        legacy: boolean;
        last_use: Date;
    };

    type Prepared_Sheet = {
        sheet_name: string;
        user_id: number;
        sheet_password: string;
        is_public: boolean;
        attributes: {};
        legacy: false;
        last_use: Date;
    };

    type Sheet_Head = {
        id: number;
        user_id: number;
        sheet_name: string;
    };

    type Macro = {
        id: number;
        user_id: number;
        user?: Express.Request['user'];
        macro_name: Macro_Name;
        macros: {
            sections: [
                {
                    name: string;
                    position: number;
                    macros: [
                        {
                            name: string;
                            position: number;
                            value: string;
                            type: Macro_Type;
                        }
                    ];
                }
            ];
        };
        is_public: boolean;
        last_use: Date;
    };

    type Macro_Head = {
        id: number;
        user_id: number;
        sheet_id?: number;
        macro_name: string;
    };

    type User_Config = {
        id: number;
        user_id: number;
        language: Available_Languages | string;
        secret_roll: boolean;
        secret_insan: boolean;
        secret_general: boolean;
        secret_sheet: boolean;
        secret_send: boolean;
    };

    type Tutorial = {
        link: string;
        title: string;
        description: string;
        thumb: string;
        tags: string[];
        tutorial: string;
    };

    type Log = {
        id: number;
        user_id?: number;
        action_type: string;
        action_target: string;
        timestamp: Date;
        status: ActivityStatus;
        source_system?: string;
    };

    type Announcement_Content = {
        [language: string]: {
            title: string;
            description: string;
            link?: string;
        };
    };

    type Announcement = {
        id: number;
        title?: string | null;
        content: Announcement_Content;
        mode: Announcement_Mode;
        repeat_interval_hours?: number | null;
        priority: number;
        is_active: boolean;
        created_at: Date;
        updated_at: Date;
    };

    type Announcement_Seen = {
        id: number;
        user_id: number;
        announcement_id: number;
        last_seen_date: Date;
    };

    namespace Express {
        interface Application {
            start: Function;
        }
        interface Request {
            startTime: number;
            user: {
                id: number;
                discord_id?: Discord_Id;
                username: string;
                avatar_url?: string;
                is_beta: boolean;
                is_premium: boolean;
            };
            interaction: Interaction;
            rawBody: Buffer;
        }
    }

    // interface Interaction {
    //     app_permissions: Snowflake;
    //     application_id: Snowflake;
    //     channel: TextChannelType;
    //     channel_id: Snowflake;
    //     context: number;
    //     data: {
    //         id: Snowflake;
    //         name: string;
    //         type: number;
    //         options?: {
    //             name: string;
    //             type: number;
    //             value: string;
    //         }[];
    //     };
    //     guild: {
    //         id: Snowflake;
    //         locale: Locale;
    //         features: string[];
    //     };
    //     guild_id: Snowflake;
    //     guild_locale: Locale;
    //     id: Snowflake;
    //     locale: Locale;
    //     member: {
    //         deaf: boolean;
    //         pending: boolean;
    //         permissions: Snowflake;
    //         roles: Snowflake[];
    //         user: {
    //             avatar: string;
    //             avatar_decoration_data: string | null;
    //             clan: string | null;
    //             discriminator: string;
    //             global_name: string;
    //             id: Snowflake;
    //             publica_flags: number;
    //             username: string;
    //         };
    //     };
    //     token: string;
    //     type: InteractionType;
    //     version: number;
    // }

    interface Message_Data {
        content?: string;
        embeds?: EmbedBuilder[];
        components?: ActionRow[ComponentBuilder[]];
        flags?: number;
    }
}
