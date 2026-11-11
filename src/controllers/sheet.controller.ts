import db from '../configs/database';
import { Prisma } from '@prisma/client';

type PreparedSheetUpdate = {
    sheet_name: Sheet_Name;
    is_public: boolean;
    attributes: {};
    sheet_layout?: Sheet_Layout | null;
    legacy: false;
    last_use: Date;
};

function toSheet(sheet: any): Sheet | null {
    try {
        return {
            id: sheet.id,
            user_id: sheet.user_id,
            sheet_name: sheet.sheet_name,
            sheet_password: sheet.sheet_password,
            is_public: sheet.is_public,
            legacy: sheet.legacy,
            attributes: sheet.attributes,
            sheet_layout: sheet.sheet_layout ?? null,
            last_use: sheet.last_use
        };
    } catch (err) {
        return null;
    }
}

function toSheetArray(sheets: any[]): Sheet[] | null {
    try {
        return sheets.map(sheet => {
            return {
                id: sheet.id,
                user_id: sheet.user_id,
                sheet_name: sheet.sheet_name,
                sheet_password: sheet.sheet_password,
                is_public: sheet.is_public,
                legacy: sheet.legacy,
                attributes: sheet.attributes,
                sheet_layout: sheet.sheet_layout ?? null,
                last_use: sheet.last_use
            };
        });
    } catch (err) {
        return null;
    }
}

function toIrtSheet(irtSheet: any): Irt_Sheet | null {
    try {
        return {
            id: irtSheet.id,
            sheet_id: irtSheet.sheet_id,
            user_id: irtSheet.user_id,
            msg_id: irtSheet.msg_id,
            channel_id: irtSheet.channel_id
        };
    } catch (err) {
        return null;
    }
}

function toIrtSheetArray(irtSheets: any[]): Irt_Sheet[] | null {
    try {
        return irtSheets.map(irtSheet => {
            return {
                id: irtSheet.id,
                sheet_id: irtSheet.sheet_id,
                user_id: irtSheet.user_id,
                msg_id: irtSheet.msg_id,
                channel_id: irtSheet.channel_id
            };
        });
    } catch (err) {
        return null;
    }
}

function toSheetHeadArray(sheets: any[]): Sheet_Head[] | null {
    try {
        return sheets.map(sheet => {
            return {
                id: sheet.id,
                user_id: sheet.user_id,
                sheet_name: sheet.sheet_name
            };
        });
    } catch (err) {
        return null;
    }
}

export default class SheetController {
    static async create(sheet: Prepared_Sheet): Promise<Sheet> {
        return toSheet(
            await db.sheets.create({
                data: {
                    user_id: sheet.user_id,
                    sheet_name: sheet.sheet_name,
                    sheet_password: sheet.sheet_password,
                    attributes: sheet.attributes,
                    is_public: sheet.is_public,
                    legacy: sheet.legacy,
                    last_use: sheet.last_use
                }
            })
        ) as Sheet;
    }

    static async getById(id: number): Promise<Sheet | null> {
        return toSheet(
            await db.sheets.findUnique({
                where: {
                    id: id
                }
            })
        );
    }

    static async getByUserId(userId: number): Promise<Sheet_Head[] | null> {
        return toSheetHeadArray(
            await db.sheets.findMany({
                where: {
                    user_id: userId
                },
                select: {
                    id: true,
                    user_id: true,
                    sheet_name: true
                }
            })
        );
    }

    static async getByUserIdAndSheetName(userId: number, sheetName: string): Promise<Sheet | null> {
        return toSheet(
            await db.sheets.findFirst({
                where: {
                    user_id: userId,
                    sheet_name: sheetName
                }
            })
        );
    }

    static async getByUsernameAndSheetName(username: string, sheetName: string): Promise<Sheet | null> {
        const user = await db.users.findUnique({ where: { username: username } });

        if (user) {
            return toSheet(
                await db.sheets.findFirst({
                    where: {
                        user_id: user.id,
                        sheet_name: sheetName
                    }
                })
            );
        } else {
            return null;
        }
    }

    static async getAllSheetsHead(): Promise<Sheet_Head[] | null> {
        return toSheetHeadArray(
            await db.sheets.findMany({
                select: {
                    id: true,
                    user_id: true,
                    sheet_name: true
                }
            })
        );
    }

    static async getAllSheetsNameByUserId(userId: number): Promise<string[]> {
        const sheets = await db.sheets.findMany({
            select: {
                sheet_name: true
            },
            where: {
                user_id: userId
            }
        });

        try {
            return sheets.map(sheet => sheet.sheet_name);
        } catch (err) {
            return [];
        }
    }

    static async countSheetsByUserId(userId: number): Promise<number> {
        return await db.sheets.count({
            where: {
                user_id: userId
            }
        });
    }

    static async updateById(id: number, newSheet: Sheet): Promise<Sheet | null> {
        return toSheet(
            await db.sheets.update({
                where: {
                    id: id
                },
                data: {
                    sheet_name: newSheet.sheet_name,
                    attributes: newSheet.attributes,
                    sheet_layout:
                        newSheet.sheet_layout === null
                            ? Prisma.DbNull
                            : (newSheet.sheet_layout as Prisma.InputJsonValue | undefined),
                    is_public: newSheet.is_public,
                    legacy: false,
                    last_use: newSheet.last_use
                }
            })
        );
    }

    static async updatePrivacyById(id: number, is_public: boolean): Promise<Sheet | null> {
        const updateData: any = {};

        if (is_public !== undefined) {
            updateData.is_public = is_public;
        }

        updateData.last_use = new Date();

        return toSheet(
            await db.sheets.update({
                where: {
                    id: id
                },
                data: updateData
            })
        );
    }

    static async updatePasswordById(id: number, sheet_password: string | null): Promise<Sheet | null> {
        const updateData: any = {};
        if (sheet_password !== undefined) {
            updateData.sheet_password = sheet_password;
        }

        updateData.last_use = new Date();

        return toSheet(
            await db.sheets.update({
                where: {
                    id: id
                },
                data: updateData
            })
        );
    }

    static async renameById(id: number, newSheetName: string): Promise<Sheet | null> {
        return toSheet(
            await db.sheets.update({
                where: {
                    id: id
                },
                data: {
                    sheet_name: newSheetName,
                    last_use: new Date()
                }
            })
        );
    }

    static async deleteById(id: number): Promise<Sheet | null> {
        return toSheet(
            await db.sheets.delete({
                where: {
                    id: id
                }
            })
        );
    }

    static async activeIrtSheet(
        userId: number,
        sheetId: number,
        msgId: string,
        channelId: string
    ): Promise<Sheet | null> {
        const sheet = await this.getById(sheetId);

        if (sheet) {
            return toSheet(
                await db.irt_sheets.create({
                    data: {
                        user_id: userId,
                        sheet_id: sheetId,
                        msg_id: msgId,
                        channel_id: channelId
                    }
                })
            );
        } else {
            throw new Error('Sheet not found');
        }
    }

    /**
     * Cria o vínculo IRT com checagem de limite atômica.
     *
     * O advisory lock é por ficha; duas execuções simultâneas de
     * `/ficha_enviar sync` não conseguem passar do limite.
     */
    static async createIrtSheetWithLimit(
        userId: number,
        sheetId: number,
        msgId: string,
        channelId: string,
        limit: number | null
    ): Promise<'created' | 'limit'> {
        return db.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`sheet:irt:${sheetId}`}))`;

            if (limit !== null) {
                const count = await tx.irt_sheets.count({
                    where: {
                        sheet_id: sheetId
                    }
                });

                if (count >= limit) {
                    return 'limit' as const;
                }
            }

            await tx.irt_sheets.create({
                data: {
                    user_id: userId,
                    sheet_id: sheetId,
                    msg_id: msgId,
                    channel_id: channelId
                }
            });

            return 'created' as const;
        });
    }

    static async getIrtSheetBySheetId(sheetId: number): Promise<Irt_Sheet[] | null> {
        return toIrtSheetArray(
            await db.irt_sheets.findMany({
                where: {
                    sheet_id: sheetId
                }
            })
        );
    }

    static async countIrtSheetBySheetId(sheetId: number): Promise<number> {
        return await db.irt_sheets.count({
            where: {
                sheet_id: sheetId
            }
        });
    }

    static async getIrtSheetByMsgId(msgId: string): Promise<Irt_Sheet | null> {
        return toIrtSheet(
            await db.irt_sheets.findFirst({
                where: {
                    msg_id: msgId
                }
            })
        );
    }

    static async deleteIrtSheetByMsgId(msgId: string): Promise<void> {
        await db.irt_sheets.deleteMany({
            where: {
                msg_id: msgId
            }
        });
    }

    static async deleteAllIrtSheetBySheetId(sheetId: number): Promise<void> {
        await db.irt_sheets.deleteMany({
            where: {
                sheet_id: sheetId
            }
        });
    }
}
