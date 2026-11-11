import SheetController from '../../controllers/sheet.controller';
import SheetServices from '../../services/sheet.services';
import logger from '../../configs/logger';

/**
 * Migra uma ficha legacy (migrada do db antigo) para o formato normal.
 *
 * Recebe o id da ficha (ou a ficha já buscada), converte `attributes`
 * (objeto plano `{ nomeDoAtributo: valor }`) para seções "Info 1..N" usando
 * a mesma regra do `createSheetEmbed` (via `SheetServices.convertLegacySheet`)
 * e salva no banco sem alterar nenhuma outra informação da ficha
 * (nome, privacidade, senha e last_use são preservados — o `updateById`
 * regrava esses campos com os valores atuais).
 *
 * Pode ser chamado no começo de qualquer comando de ficha: se a ficha não
 * for legacy (ou não existir), ela é retornada intacta sem nenhuma escrita
 * no banco.
 *
 * @returns a ficha (migrada ou original) ou null se não encontrada.
 */
export default async function migrateLegacySheet(sheetIdOrSheet: number | Sheet): Promise<Sheet | null> {
    const sheet = typeof sheetIdOrSheet === 'number' ? await SheetController.getById(sheetIdOrSheet) : sheetIdOrSheet;

    if (!sheet || sheet.legacy != true) {
        return sheet;
    }

    SheetServices.convertLegacySheet(sheet);

    try {
        return await SheetController.updateById(sheet.id, sheet);
    } catch (err) {
        logger.error(err, { event: 'sheet.migrate.error', sheet_id: sheet.id });
        return sheet;
    }
}
