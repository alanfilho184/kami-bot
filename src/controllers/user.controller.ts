import db from '../configs/database';

type PreparedUser = {
    discord_id?: string;
    username: string;
    email: string | null;
    avatar?: string;
    password: string | null;
};

function hasSiteAccount(user: any): boolean {
    return Boolean(user.email && typeof user.password === 'string' && /^\$2[aby]\$/.test(user.password));
}

function toUser(user: any): User | (User & User_Config) | null {
    try {
        if (user.user_config && user.user_config.length > 0) {
            return {
                id: user.id,
                discord_id: user.discord_id,
                username: user.username,
                avatar: user.avatar,
                email: user.email,
                password: user.password,
                has_site_account: hasSiteAccount(user),
                is_beta: user.is_beta,
                is_premium: user.is_premium,
                last_use: user.last_use,
                language: `${user.user_config[0].language}`.toLowerCase().replace('_', '-') as Available_Languages,
                secret_general: user.user_config[0].secret_general,
                secret_insan: user.user_config[0].secret_insan,
                secret_roll: user.user_config[0].secret_roll,
                secret_send: user.user_config[0].secret_send,
                secret_sheet: user.user_config[0].secret_sheet
            };
        } else {
            return {
                id: user.id,
                discord_id: user.discord_id,
                username: user.username,
                avatar: user.avatar,
                email: user.email,
                password: user.password,
                has_site_account: hasSiteAccount(user),
                is_beta: user.is_beta,
                is_premium: user.is_premium,
                last_use: user.last_use
            };
        }
    } catch (err) {
        return null;
    }
}

function toUserArray(users: any[]): User[] {
    const usersArray: User[] = [];

    users.forEach(prismaUser => {
        const user = toUser(prismaUser);
        if (user) {
            usersArray.push(user);
        }
    });

    return usersArray;
}

export default class UserController {
    static async create(user: PreparedUser): Promise<User | null> {
        return toUser(
            await db.users.create({
                data: {
                    discord_id: user.discord_id,
                    username: user.username,
                    email: user.email,
                    avatar: user.avatar,
                    password: user.password
                }
            })
        );
    }

    static async getById(id: number): Promise<(User & User_Config) | null> {
        return toUser(
            await db.users.findUnique({
                where: {
                    id: id
                },
                include: {
                    user_config: true
                }
            })
        ) as (User & User_Config) | null;
    }

    static async getByUsername(username: string): Promise<User | null> {
        return toUser(
            await db.users.findUnique({
                where: {
                    username: username
                },
                include: {
                    user_config: true
                }
            })
        );
    }

    static async getByEmail(email: string): Promise<User | null> {
        return toUser(
            await db.users.findUnique({
                where: {
                    email: email
                },
                include: {
                    user_config: true
                }
            })
        );
    }

    static async getByDiscordId(discordId: string): Promise<(User & User_Config) | null> {
        return toUser(
            await db.users.findUnique({
                where: {
                    discord_id: discordId
                },
                include: {
                    user_config: true
                }
            })
        ) as (User & User_Config) | null;
    }

    static async searchByUsername(username: string): Promise<User | null> {
        return toUser(
            await db.users.findFirst({
                where: {
                    username: {
                        contains: username,
                        mode: 'insensitive'
                    }
                },
                include: {
                    user_config: true
                }
            })
        );
    }

    static async updateById(id: number, newUser: any): Promise<User | null> {
        return toUser(
            await db.users.update({
                where: {
                    id: id
                },
                data: newUser
            })
        );
    }

    static async updateLastUseById(id: number): Promise<User | null> {
        return toUser(
            await db.users.update({
                where: {
                    id: id
                },
                data: {
                    last_use: new Date()
                }
            })
        );
    }

    static async updateUserConfigById(
        id: number,
        newConfig: Partial<{
            secret_general: boolean;
            secret_insan: boolean;
            secret_roll: boolean;
            secret_send: boolean;
            secret_sheet: boolean;
            language: Available_Languages | null;
        }>
    ): Promise<void> {
        const updateData: any = {};
        const createData: any = { user_id: id };

        if (newConfig.secret_general !== undefined) {
            updateData.secret_general = newConfig.secret_general;
            createData.secret_general = newConfig.secret_general;
        }

        if (newConfig.secret_insan !== undefined) {
            updateData.secret_insan = newConfig.secret_insan;
            createData.secret_insan = newConfig.secret_insan;
        }

        if (newConfig.secret_roll !== undefined) {
            updateData.secret_roll = newConfig.secret_roll;
            createData.secret_roll = newConfig.secret_roll;
        }

        if (newConfig.secret_send !== undefined) {
            updateData.secret_send = newConfig.secret_send;
            createData.secret_send = newConfig.secret_send;
        }

        if (newConfig.secret_sheet !== undefined) {
            updateData.secret_sheet = newConfig.secret_sheet;
            createData.secret_sheet = newConfig.secret_sheet;
        }

        if (newConfig.language !== undefined) {
            updateData.language = `${newConfig.language}`.toUpperCase().replace('-', '_');
            createData.language = `${newConfig.language}`.toUpperCase().replace('-', '_');
        }

        await db.users_config.upsert({
            where: {
                user_id: id
            },
            update: updateData,
            create: createData
        });
    }

    // static async mergeByIdAndDiscordId(user: Express.Request['user'], discordUser: User) {
    //     const newId = user.id
    //     const oldId = discordUser.id

    //     db.$transaction([
    //         db.sheets.updateMany({
    //             where: {
    //                 user_id: oldId,
    //             },
    //             data: {
    //                 user_id: newId,
    //             }
    //         }),
    //         db.irt_sheets.updateMany({
    //             where: {
    //                 user_id: oldId,
    //             },
    //             data: {
    //                 user_id: newId,
    //             }
    //         }),
    //         db.users_config.updateMany({
    //             where: {
    //                 user_id: oldId,
    //             },
    //             data: {
    //                 user_id: newId,
    //             }
    //         }),
    //         db.blocked_users.updateMany({
    //             where: {
    //                 user_id: oldId,
    //             },
    //             data: {
    //                 user_id: newId,
    //             }
    //         }),
    //         db.users.delete({
    //             where: {
    //                 id: oldId,
    //             }
    //         }),
    //         db.users.update({
    //             where: {
    //                 id: newId,
    //             },
    //             data: {
    //                 discord_id: `${discordUser.discord_id}`,
    //             }
    //         })
    //     ])
    // }
}
