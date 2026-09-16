import { globSync } from 'glob';
import logger from '../../configs/logger';
import fs from 'node:fs';
import path from 'node:path';
import { Available_Languages } from '../../types/enums';

const languages: { [language: string]: { [key: string]: string } } = {};

const cwdNormalized = process.cwd().replace(/\\/g, '/');
const searchPatterns = [
    `${cwdNormalized}/src/resources/localization/**/*.json`,
    `${cwdNormalized}/dist/resources/localization/**/*.json`
];

const translationFiles = globSync(searchPatterns);

translationFiles.forEach(translationPathString => {
    const normalizedPath = translationPathString.replace(/\\/g, '/');
    try {
        const translation: { [key: string]: string } = JSON.parse(fs.readFileSync(normalizedPath, 'utf-8'));

        const langKey = `${translation['language']}`.toLowerCase().replace('_', '-');
        languages[langKey] = { ...languages[langKey], ...translation };
    } catch (err) {
        logger.logText('ERROR', `Failed to load localization file: ${normalizedPath} - ${err}`);
    }
});

function replaceAll(string: string, search: string, replace: string) {
    return string.split(search).join(replace);
}

export function localization(
    language: Available_Languages,
    key: string,
    replaces?: { replace: string; value: string | number }[]
) {
    try {
        let languageNormalized = language.toLowerCase().replace('_', '-');
        let translation = languages[languageNormalized][key];

        if (Array.isArray(translation)) {
            translation = translation.join('\n');
        }

        if (replaces) {
            replaces.forEach(replace => {
                translation = replaceAll(translation, replace.replace, replace.value.toString());
            });
        }

        if (translation === undefined) {
            logger.logText('ERROR', `Localization not found: ${languageNormalized} - ${key} - ${replaces}`);
            return 'Localization error';
        }

        return translation;
    } catch (error) {
        logger.logText('WARN', `Localization error: ${language} - ${key} - ${replaces}`);
        logger.logText('ERROR', error);
        return 'Localization error';
    }
}
