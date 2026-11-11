import { Interaction } from '../resources/utils/interaction-handler';
import SheetController from '../controllers/sheet.controller';
import { localization } from '../resources/localization';
import { Command_Category } from '../types/enums';
import { deactivateIrtSheet } from '../resources/utils/irt';

export default {
    name: 'deactivate-irt',
    ownerOnly: false,
    type: 'bot',
    category: Command_Category.SHEET_ALTER,
    run: async (int: Interaction, language: Available_Languages) => {
        const irtSheet = await SheetController.getIrtSheetByMsgId(int.component!.args);

        if (irtSheet === null || irtSheet.user_id !== int.kami_user!.id) {
            return await int.reply({
                content: localization(language, 'sheet-send|irt-not-found')
            });
        }

        await deactivateIrtSheet(irtSheet);

        return await int.reply({
            content: localization(language, 'sheet-send|irt-deactivated')
        });
    }
};
