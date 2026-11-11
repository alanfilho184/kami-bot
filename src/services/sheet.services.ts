import db from '../configs/database';
import SheetController from '../controllers/sheet.controller';
import { hashPassword, verifyPassword } from '../resources/utils/crypto';
import { Sheet_Name } from '../types/validations';
import { Attribute_Type } from '../types/enums';

class SheetServices {
    //public static textRegex: RegExp = /^[a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ+#@$%&*{}()/.,;:?!'"-_| ]{1,}(?: [a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ+#@$%&*{}()/.,;:?!'"-_| ]+){0,}$/gim;
    // Sem a flag `g`: estes regex são usados com `.test()` várias vezes e o
    // `lastIndex` persistente fazia validações alternarem entre true/false.
    public static textRegex: RegExp =
        /([a-zA-Z0-9]+\(([a-zA-Z0-9\s<>.,;:?!@#$%¨&*()_+-={}\[\]\\|/?°ºª``^~]+\)))|((if|IF|or|OR|xor|XOR)(((\s+\(("|')([a-zA-Z0-9\s<>.,;:?!@#$%¨&*()_+-={}\[\]\\|/?°ºª``^~]+))("|')\))|(\s("|')([a-zA-Z0-9]+)("|'))))|(select|SELECT|insert|INSERT|update|UPDATE|delete|DELETE)|((\s+\*+\s)|(.+)|(\s+[a-zA-Z0-9]+))(from|FROM|into|INTO)((\s+[a-zA-Z0-9]\w+))|\s+(where|WHERE)/im;
    public static numberRegex: RegExp = /^(-?[0-9]+)$/im;
    public static positiveNumberRegex: RegExp = /^([0-9]+)$/im;
    public static imageRegex: RegExp = /https?:\/\/.*\.(?:png|jpg|jpeg|gif|svg|webp)/i;

    static prepareNewSheet(name: string, userId: number): Prepared_Sheet {
        const newSheet: Prepared_Sheet = {
            sheet_name: name,
            user_id: userId,
            sheet_password: Math.random().toString(36).slice(-8),
            attributes: { sections: new Array() },
            is_public: false,
            legacy: false,
            last_use: new Date()
        };

        return newSheet;
    }

    static readonly LEGACY_SECTION_SIZE = 25;

    static convertLegacySheet(sheet: Sheet): Sheet {
        if (sheet.legacy != true) {
            return sheet;
        }

        const raw = sheet.attributes as unknown as Record<string, unknown> | null | undefined;

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            sheet.attributes = { sections: [] } as unknown as Sheet['attributes'];
            sheet.legacy = false;
            return sheet;
        }

        if ('sections' in raw && Array.isArray((raw as { sections?: unknown }).sections)) {
            sheet.legacy = false;
            return sheet;
        }

        const keys = Object.keys(raw);
        const sectionCount = Math.ceil(keys.length / SheetServices.LEGACY_SECTION_SIZE);
        const sections: Array<{
            name: string;
            position: number;
            type: number;
            attributes: Array<{ name: string; value: string | number; type: Attribute_Type; position: number }>;
        }> = [];

        let absolutePosition = 0;
        for (let s = 0; s < sectionCount; s++) {
            const sectionAttributes = keys
                .slice(
                    s * SheetServices.LEGACY_SECTION_SIZE,
                    s * SheetServices.LEGACY_SECTION_SIZE + SheetServices.LEGACY_SECTION_SIZE
                )
                .map(key => ({
                    name: key,
                    value: (raw as Record<string, unknown>)[key] as unknown as string | number,
                    type: isNaN(Number((raw as Record<string, unknown>)[key]))
                        ? Attribute_Type.TEXT
                        : Attribute_Type.NUMBER,
                    position: absolutePosition++
                }));

            sections.push({
                name: `Info ${s + 1}`,
                position: s,
                type: 0,
                attributes: sectionAttributes
            });
        }

        sheet.attributes = { sections } as unknown as Sheet['attributes'];
        sheet.legacy = false;
        return sheet;
    }

    static async validateModification(
        sheet: Sheet,
        attribute_type: Attribute_Type,
        section: string,
        attribute: string,
        value: string,
        position?: number
    ): Promise<Array<{ field: string; code: string }> | Sheet> {
        const errors: Array<{ field: string; code: string }> = [];

        SheetServices.convertLegacySheet(sheet);

        if (attribute_type == Attribute_Type.TEXT) {
            section = `${section}`;
            attribute = `${attribute}`;
            value = `${value}`;
            position = position ? parseInt(`${position}`) : undefined;

            if (attribute.length < 1 || attribute.length > 256) {
                errors.push({ field: 'attribute', code: 'name-size' });
            }

            if (this.textRegex.test(attribute)) {
                errors.push({ field: 'attribute', code: 'name-invalid' });
            }

            if (value.length < 1 || value.length > 1024) {
                errors.push({ field: 'value', code: 'value-size' });
            }

            if (this.textRegex.test(value)) {
                errors.push({ field: 'value', code: 'value-invalid' });
            }

            if (section.length < 1 || section.length > 256) {
                errors.push({ field: 'section', code: 'section-size' });
            }

            if (this.textRegex.test(section)) {
                errors.push({ field: 'section', code: 'section-invalid' });
            }

            if (position && position < 0) {
                errors.push({ field: 'position', code: 'position-invalid' });
            }
        } else if (attribute_type == Attribute_Type.NUMBER) {
            section = `${section}`;
            attribute = `${attribute}`;
            value = `${value}`;
            position = position ? parseInt(`${position}`) : undefined;

            if (attribute.length < 1 || attribute.length > 256) {
                errors.push({ field: 'attribute', code: 'name-size' });
            }

            if (this.textRegex.test(attribute)) {
                errors.push({ field: 'attribute', code: 'name-invalid' });
            }

            if (value.length < 1 || value.length > 1024) {
                errors.push({ field: 'value', code: 'value-size' });
            }

            if (this.numberRegex.test(value)) {
                errors.push({ field: 'value', code: 'value-invalid' });
            }

            if (section.length < 1 || section.length > 256) {
                errors.push({ field: 'section', code: 'section-size' });
            }

            if (this.textRegex.test(section)) {
                errors.push({ field: 'section', code: 'section-invalid' });
            }

            if (position && position < 0) {
                errors.push({ field: 'position', code: 'position-invalid' });
            }
        } else if (attribute_type == Attribute_Type.IMAGE) {
            section = `${section}`;
            attribute = `${attribute}`;
            value = `${value}`;
            position = position ? parseInt(`${position}`) : undefined;

            if (attribute.length < 1 || attribute.length > 256) {
                errors.push({ field: 'attribute', code: 'name-size' });
            }

            if (this.textRegex.test(attribute)) {
                errors.push({ field: 'attribute', code: 'name-invalid' });
            }

            if (value.length < 1 || value.length > 1024) {
                errors.push({ field: 'value', code: 'value-size' });
            }

            //TODO: Possivelmente mudar pra regex de url para não precisar do http/https
            if (!this.imageRegex.test(value)) {
                errors.push({ field: 'value', code: 'value-invalid' });
            }

            if (section.length < 1 || section.length > 256) {
                errors.push({ field: 'section', code: 'section-size' });
            }

            if (this.textRegex.test(section)) {
                errors.push({ field: 'section', code: 'section-invalid' });
            }

            if (position && position < 0) {
                errors.push({ field: 'position', code: 'position-invalid' });
            }
        } else if (attribute_type == Attribute_Type.LIST) {
            //TODO: implementar a conversão de texto pro atributo correto
            section = `${section}`;
            attribute = `${attribute}`;
            value = `${value}`;
            position = position ? parseInt(`${position}`) : undefined;

            let listItem = {
                action: value.split(':')[0],
                quantity: '',
                value: '',
                item: -1
            };

            //add: 2|texto do item
            //mod item 5: 1|texto do item
            //mod item 1: 1|novo texto do item
            //del: texto do item

            if (listItem.action === 'add') {
                listItem.value = value.split('|')[1].trim();
                listItem.quantity = value.split('|')[0];
                listItem.quantity = listItem.quantity.replace('add:', '').trim();
            } else if (listItem.action.startsWith('del')) {
                listItem.value = value.replace('del:', '').trim();
            } else if (listItem.action.startsWith('mod')) {
                listItem.value = value.split('|')[1].trim();
                listItem.item = parseInt(listItem.action.split('item')[1].split(':')[0].trim());
                listItem.quantity = value.split('|')[0].split(':')[1].trim();
            }

            if (attribute.length < 1 || attribute.length > 256) {
                errors.push({ field: 'attribute', code: 'name-size' });
            }

            if (this.textRegex.test(attribute)) {
                errors.push({ field: 'attribute', code: 'name-invalid' });
            }

            if (value.length < 1 || value.length > 1024) {
                errors.push({ field: 'value', code: 'value-size' });
            }

            if (this.textRegex.test(listItem.value)) {
                errors.push({ field: 'value', code: 'value-invalid' });
            }

            if (`${listItem.quantity}`.length > 32) {
                errors.push({ field: 'value', code: 'quantity-size' });
            }

            if (section.length < 1 || section.length > 256) {
                errors.push({ field: 'section', code: 'section-size' });
            }

            if (this.textRegex.test(section)) {
                errors.push({ field: 'section', code: 'section-invalid' });
            }

            if (position && position < 0) {
                errors.push({ field: 'position', code: 'position-invalid' });
            }

            if (listItem.action === 'add') {
                if (sheet.attributes.sections.find(s => s.name === section)) {
                    let sheet_section = sheet.attributes.sections.find(s => s.name === section);

                    if (!sheet_section) {
                        sheet_section = {
                            name: section,
                            position: sheet.attributes.sections.length,
                            attributes: [],
                            type: 0
                        };
                    }

                    let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

                    if (sheet_attribute) {
                        if (sheet_attribute.type == Attribute_Type.LIST) {
                            let list = (
                                sheet_attribute.value as unknown as {
                                    items: Array<{ name: string; quantity: string | number }>;
                                }
                            ).items;

                            if (Array.isArray(list)) {
                                list.push({ name: listItem.value, quantity: listItem.quantity });
                            } else {
                                list = [{ name: listItem.value, quantity: listItem.quantity }];
                            }

                            //@ts-ignore
                            value = { items: list };
                        } else {
                            //@ts-ignore
                            value = { items: [{ name: listItem.value, quantity: listItem.quantity }] };
                        }
                    } else {
                        //@ts-ignore
                        value = { items: [{ name: listItem.value, quantity: listItem.quantity }] };
                    }
                } else {
                    //@ts-ignore
                    value = { items: [{ name: listItem.value, quantity: listItem.quantity }] };
                }
            } else if (listItem.action.startsWith('del')) {
                if (sheet.attributes.sections.find(s => s.name === section)) {
                    let sheet_section = sheet.attributes.sections.find(s => s.name === section);

                    if (!sheet_section) {
                        sheet_section = {
                            name: section,
                            position: sheet.attributes.sections.length,
                            attributes: [],
                            type: 0
                        };
                    }

                    let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

                    if (sheet_attribute) {
                        if (sheet_attribute.type == Attribute_Type.LIST) {
                            let list = (
                                sheet_attribute.value as unknown as {
                                    items: Array<{ name: string; quantity: string | number }>;
                                }
                            ).items;

                            if (Array.isArray(list)) {
                                list = list.filter((item, index) => {
                                    return `${item.name}`.trim() !== listItem.value;
                                });
                            }

                            //@ts-ignore
                            value = { items: list };
                        }
                    }
                }
                //TODO: maybe add a else
            } else if (listItem.action.startsWith('mod')) {
                if (sheet.attributes.sections.find(s => s.name === section)) {
                    let sheet_section = sheet.attributes.sections.find(s => s.name === section);

                    if (!sheet_section) {
                        sheet_section = {
                            name: section,
                            position: sheet.attributes.sections.length,
                            attributes: [],
                            type: 0
                        };
                    }

                    let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

                    if (sheet_attribute) {
                        if (sheet_attribute.type == Attribute_Type.LIST) {
                            let list = (
                                sheet_attribute.value as unknown as {
                                    items: Array<{ name: string; quantity: string | number }>;
                                }
                            ).items;

                            if (Array.isArray(list)) {
                                list = list.map((item, index) => {
                                    if (index + 1 === listItem.item) {
                                        item.name = listItem.value;
                                        item.quantity = listItem.quantity;
                                    }

                                    return item;
                                });
                            }

                            //@ts-ignore
                            value = { items: list };
                        }
                    }
                }
                //TODO: maybe add a else
            }
        } else if (attribute_type == Attribute_Type.BAR) {
            section = `${section}`;
            attribute = `${attribute}`;
            value = `${value}`;
            position = position ? parseInt(`${position}`) : undefined;

            let barItem = {
                action: value[0] == '+' ? 'add' : value[0] == '-' ? 'sub' : 'mod',
                value: ''
            };

            if (barItem.action === 'add') {
                barItem.value = value.replace('+', '').trim();
            } else if (barItem.action === 'sub') {
                barItem.value = value.replace('-', '').trim();
            } else if (barItem.action === 'mod') {
                barItem.value = value;
            }

            if (attribute.length < 1 || attribute.length > 256) {
                errors.push({ field: 'attribute', code: 'name-size' });
            }

            if (this.textRegex.test(attribute)) {
                errors.push({ field: 'attribute', code: 'name-invalid' });
            }

            if (value.length < 1 || value.length > 1024) {
                errors.push({ field: 'value', code: 'value-size' });
            }

            if (this.textRegex.test(value)) {
                errors.push({ field: 'value', code: 'value-invalid' });
            }

            if (section.length < 1 || section.length > 256) {
                errors.push({ field: 'section', code: 'section-size' });
            }

            if (this.textRegex.test(section)) {
                errors.push({ field: 'section', code: 'section-invalid' });
            }

            if (position && position < 0) {
                errors.push({ field: 'position', code: 'position-invalid' });
            }

            if (barItem.action === 'add') {
                if (sheet.attributes.sections.find(s => s.name === section)) {
                    let sheet_section = sheet.attributes.sections.find(s => s.name === section);

                    if (!sheet_section) {
                        errors.push({ field: 'section', code: 'section-not-found' });
                    } else {
                        let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

                        if (sheet_attribute) {
                            if (sheet_attribute.type == Attribute_Type.BAR) {
                                let bar = sheet_attribute.value as unknown as {
                                    actual: number;
                                    max: number;
                                    min: number;
                                    step: number;
                                };

                                if (bar) {
                                    bar.actual += parseInt(barItem.value);

                                    //@ts-ignore
                                    value = bar;
                                } else {
                                    errors.push({ field: 'attribute', code: 'type-mismatch' });
                                }
                            } else {
                                errors.push({ field: 'attribute', code: 'type-mismatch' });
                            }
                        } else {
                            errors.push({ field: 'attribute', code: 'attribute-not-found' });
                        }
                    }
                }
            } else if (barItem.action === 'sub') {
                if (sheet.attributes.sections.find(s => s.name === section)) {
                    let sheet_section = sheet.attributes.sections.find(s => s.name === section);

                    if (!sheet_section) {
                        errors.push({ field: 'section', code: 'section-not-found' });
                    } else {
                        let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

                        if (sheet_attribute) {
                            if (sheet_attribute.type == Attribute_Type.BAR) {
                                let bar = sheet_attribute.value as unknown as {
                                    actual: number;
                                    max: number;
                                    min: number;
                                    step: number;
                                };

                                if (bar) {
                                    bar.actual -= parseInt(barItem.value);

                                    //@ts-ignore
                                    value = bar;
                                } else {
                                    errors.push({ field: 'attribute', code: 'attribute-not-found' });
                                }
                            } else {
                                errors.push({ field: 'attribute', code: 'type-mismatch' });
                            }
                        } else {
                            errors.push({ field: 'attribute', code: 'attribute-not-found' });
                        }
                    }
                }
            } else if (barItem.action === 'mod') {
                if (sheet.attributes.sections.find(s => s.name === section)) {
                    let sheet_section = sheet.attributes.sections.find(s => s.name === section);

                    if (!sheet_section) {
                        errors.push({ field: 'section', code: 'section-not-found' });
                    } else {
                        let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

                        if (sheet_attribute) {
                            if (sheet_attribute.type == Attribute_Type.BAR) {
                                let bar = sheet_attribute.value as unknown as {
                                    actual: number;
                                    max: number;
                                    min: number;
                                    step: number;
                                };

                                if (bar) {
                                    let barValue = barItem.value.split('/');
                                    bar.actual = parseInt(barValue[0]);
                                    bar.max = parseInt(barValue[1]);

                                    //@ts-ignore
                                    value = bar;
                                } else {
                                    let bar = {
                                        actual: parseInt(barItem.value.split('/')[0]),
                                        max: parseInt(barItem.value.split('/')[1]),
                                        min: 0,
                                        step: 1
                                    };

                                    //@ts-ignore
                                    value = bar;
                                }
                            } else {
                                errors.push({ field: 'attribute', code: 'type-mismatch' });
                            }
                        } else {
                            errors.push({ field: 'attribute', code: 'attribute-not-found' });
                        }
                    }
                }
            }
        } else {
            errors.push({ field: 'attribute_type', code: 'invalid' });
        }

        if (errors.length === 0) {
            let sheet_section = sheet.attributes.sections.find(s => s.name === section);

            if (!sheet_section) {
                sheet_section = { name: section, position: sheet.attributes.sections.length, attributes: [], type: 0 };
            }

            let sheet_attribute = sheet_section.attributes.find(a => a.name === attribute);

            if (!sheet_attribute) {
                position = position ? position : sheet_section.attributes.length;
                sheet_attribute = { name: attribute, value: value, position: position, type: attribute_type };
            } else {
                sheet_attribute.value = value;
                if (position) {
                    sheet_attribute.position = position;
                }

                if (sheet_attribute.type !== attribute_type) {
                    sheet_attribute.type = attribute_type;
                }
            }

            let attribute_index = sheet_section.attributes.findIndex(a => a.name === attribute);
            let section_index = sheet_section.position;

            if (attribute_index === -1) {
                if (position) {
                    sheet_section.attributes.splice(position, 0, sheet_attribute);
                } else {
                    sheet_section.attributes.push(sheet_attribute);
                }
            } else {
                sheet_section.attributes[attribute_index] = sheet_attribute;
            }

            sheet.attributes.sections[section_index] = sheet_section;
            sheet.last_use = new Date();

            return sheet;
        } else {
            return errors;
        }
    }

    static async hashPasswordValue(password: string): Promise<string> {
        return await hashPassword(password);
    }

    static async verifySheetPassword(sheet: Sheet, password: string): Promise<boolean> {
        try {
            if (!password) return false;

            const stored = (sheet as any).sheet_password;

            // bcrypt hashes usually start with $2a$ or $2b$ or $2y$
            const bcryptRegex = /^\$2[aby]\$/;

            if (typeof stored === 'string' && bcryptRegex.test(stored)) {
                return await verifyPassword(stored, password);
            }

            // fallback to plaintext comparison for non-hashed entries
            return stored === password;
        } catch (err) {
            return false;
        }
    }

    static async validateDeleteAttribute(
        sheet: Sheet,
        section: string,
        attribute: string
    ): Promise<Array<{ field: string; code: string }> | Sheet> {
        const errors: Array<{ field: string; code: string }> = [];

        SheetServices.convertLegacySheet(sheet);

        section = `${section}`;
        attribute = `${attribute}`;

        const sectionIndex = sheet.attributes.sections.findIndex(s => s.name === section);

        if (sectionIndex === -1) {
            errors.push({ field: 'section', code: 'section-not-found' });
            return errors;
        }

        const sheet_section = sheet.attributes.sections[sectionIndex];
        const attributeIndex = sheet_section.attributes.findIndex(a => a.name === attribute);

        if (attributeIndex === -1) {
            errors.push({ field: 'attribute', code: 'attribute-not-found' });
            return errors;
        }

        sheet_section.attributes.splice(attributeIndex, 1);

        sheet_section.attributes.forEach((a, idx) => {
            a.position = idx;
        });

        sheet.attributes.sections[sectionIndex] = sheet_section;
        sheet.last_use = new Date();

        return sheet;
    }

    static async validateDeleteSection(
        sheet: Sheet,
        section: string
    ): Promise<Array<{ field: string; code: string }> | Sheet> {
        const errors: Array<{ field: string; code: string }> = [];

        SheetServices.convertLegacySheet(sheet);

        section = `${section}`;

        const sectionIndex = sheet.attributes.sections.findIndex(s => s.name === section);

        if (sectionIndex === -1) {
            errors.push({ field: 'section', code: 'section-not-found' });
            return errors;
        }

        sheet.attributes.sections.splice(sectionIndex, 1);

        sheet.attributes.sections.forEach((s, idx) => {
            s.position = idx;
            if (Array.isArray(s.attributes)) {
                s.attributes.forEach((a, j) => {
                    a.position = j;
                });
            }
        });

        sheet.last_use = new Date();

        return sheet;
    }

    static async validateRenameAttribute(
        sheet: Sheet,
        section: string,
        oldName: string,
        newName: string
    ): Promise<Array<{ field: string; code: string }> | Sheet> {
        const errors: Array<{ field: string; code: string }> = [];

        SheetServices.convertLegacySheet(sheet);

        section = `${section}`;
        oldName = `${oldName}`;
        newName = `${newName}`;

        if (newName.length < 1 || newName.length > 256) {
            errors.push({ field: 'attribute', code: 'name-size' });
        }

        if (this.textRegex.test(newName)) {
            errors.push({ field: 'attribute', code: 'name-invalid' });
        }

        if (this.textRegex.test(section)) {
            errors.push({ field: 'section', code: 'section-invalid' });
        }

        if (errors.length > 0) {
            return errors;
        }

        const sectionIndex = sheet.attributes.sections.findIndex(s => s.name === section);

        if (sectionIndex === -1) {
            errors.push({ field: 'section', code: 'section-not-found' });
            return errors;
        }

        const sheet_section = sheet.attributes.sections[sectionIndex];
        const attributeIndex = sheet_section.attributes.findIndex(a => a.name === oldName);

        if (attributeIndex === -1) {
            errors.push({ field: 'attribute', code: 'attribute-not-found' });
            return errors;
        }

        const duplicate = sheet_section.attributes.find(a => a.name === newName);
        if (duplicate) {
            errors.push({ field: 'attribute', code: 'name-duplicate' });
            return errors;
        }

        sheet_section.attributes[attributeIndex].name = newName;
        sheet.attributes.sections[sectionIndex] = sheet_section;
        sheet.last_use = new Date();

        return sheet;
    }

    static async validateRenameSection(
        sheet: Sheet,
        oldName: string,
        newName: string
    ): Promise<Array<{ field: string; code: string }> | Sheet> {
        const errors: Array<{ field: string; code: string }> = [];

        SheetServices.convertLegacySheet(sheet);

        oldName = `${oldName}`;
        newName = `${newName}`;

        if (newName.length < 1 || newName.length > 256) {
            errors.push({ field: 'section', code: 'section-size' });
        }

        if (this.textRegex.test(newName)) {
            errors.push({ field: 'section', code: 'section-invalid' });
        }

        if (errors.length > 0) {
            return errors;
        }

        const sectionIndex = sheet.attributes.sections.findIndex(s => s.name === oldName);

        if (sectionIndex === -1) {
            errors.push({ field: 'section', code: 'section-not-found' });
            return errors;
        }

        const duplicate = sheet.attributes.sections.find(s => s.name === newName);
        if (duplicate) {
            errors.push({ field: 'section', code: 'name-duplicate' });
            return errors;
        }

        sheet.attributes.sections[sectionIndex].name = newName;
        sheet.last_use = new Date();

        return sheet;
    }
}

export default SheetServices;
