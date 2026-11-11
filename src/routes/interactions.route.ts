import { Router, Request, Response } from 'express';
import { InteractionResponseType, InteractionType } from 'discord-interactions';
import { Interaction } from '../resources/utils/interaction-handler';
import commands from '../commands';
import components from '../components';
import logger from '../configs/logger';
import commandsStatistics from '../resources/utils/command-statistics';
import { localization } from '../resources/localization';
import { Available_Languages, Command_Category } from '../types/enums';
import actionHandler from '../resources/utils/action-handler';
import announcements from '../modules/announcements';
import metrics from '../resources/utils/metrics';
import { performance } from 'node:perf_hooks';

const router = Router();

router.post('/interactions', async (req: Request, res: Response) => {
    // Marcador monotônico do início do processamento: o delta Date.now() abaixo
    // depende do sync com o relógio do Discord, este não.
    const receivedAt = performance.now();

    // PING é usado pelo Discord para validar o endpoint e não traz user/guild
    // em todas as versões do payload. Responde antes de construir `Interaction`
    // e antes de qualquer consulta ao banco.
    if (req.body?.type === InteractionType.PING) {
        return res.json({
            type: InteractionResponseType.PONG
        });
    }

    let int: Interaction;
    try {
        int = new Interaction(req.body, res);
    } catch (err) {
        //@ts-ignore
        if (err.message == 'Unknown user') {
            return;
        } else {
            return logger.error(err, { event: 'discord.interaction.error' });
        }
    }

    // Latência de entrada: do momento em que o Discord criou a interação até
    // a requisição chegar aqui. O valor vai CRU (com sinal) de propósito: um
    // delta negativo ou quase zero revela que o relógio local está fora de
    // sincronia com o do Discord, e um clamp aqui esconderia esse sintoma.
    const ingress = Date.now() - int.createdTimestamp;
    const record = () => metrics.recordInteraction(ingress, performance.now() - receivedAt);

    if ((int.user.system === true || int.user.bot === true) && int.type != 1) {
        return res.end();
    }

    await int.loadUser();
    logger.setUserId(int.kami_user?.id ?? null);

    if (int.type === InteractionType.PING) {
        res.json({
            type: InteractionResponseType.PONG
        });
    } else if (int.type === InteractionType.APPLICATION_COMMAND) {
        logger.logDiscord(int).catch(() => undefined);
        const command = commands.get(int.data.name);

        if (!command) {
            await int.acknowledge(true);
            logger.logInteractionResult(int, { execution_ms: 0, event: 'discord.command.rejected' });
            return await int.reply({
                content: localization(int.language, 'cmd-interaction|command-not-found')
            });
        } else {
            if (command.ownerOnly && int.user.id !== process.env.OWNER_ID) {
                await int.acknowledge(true);
                logger.logInteractionResult(int, { execution_ms: 0, event: 'discord.command.rejected' });
                return await int.reply({
                    content: localization(int.language, 'cmd-interaction|owner-only')
                });
            } else {
                if (!command.doNotAcknowledge) {
                    switch (command.category) {
                        case Command_Category.GENERAL:
                            await int.acknowledge(int.kami_user?.secret_general);
                            break;
                        case Command_Category.INSANITY:
                            await int.acknowledge(int.kami_user?.secret_insan);
                            break;
                        case Command_Category.ROLL:
                            await int.acknowledge(int.kami_user?.secret_roll);
                            break;
                        case Command_Category.SHEET_ALTER:
                            await int.acknowledge(int.kami_user?.secret_sheet);
                            break;
                        case Command_Category.SHEET_SEND:
                            await int.acknowledge(int.kami_user?.secret_send);
                            break;
                        default:
                            await int.acknowledge();
                            break;
                    }
                }

                let commandError: unknown;
                let commandFailed = false;

                int.startCommandTimer();

                try {
                    await command.run(int, int.language);
                    commandsStatistics.logCommand({
                        commandName: command.commandNames[Available_Languages['en-us']],
                        userId: int.kami_user?.id || 0,
                        status: 'SUCCESS',
                        source_system: 'INTERACTION_API'
                    });

                    await announcements.announce(int);
                } catch (err) {
                    commandError = err;
                    commandFailed = true;
                    logger.error(err, { event: 'discord.command.error', action: int.data.name });
                    commandsStatistics.logCommand({
                        commandName: command.commandNames[Available_Languages['en-us']],
                        userId: int.kami_user?.id || 0,
                        status: 'FAILED',
                        source_system: 'INTERACTION_API'
                    });
                    await int.reply({
                        content: localization(int.language, 'cmd-interaction|command-error')
                    });
                } finally {
                    const executionMs = int.stopCommandTimer();
                    record();
                    logger.logInteractionResult(int, {
                        execution_ms: executionMs,
                        event: commandFailed ? 'discord.command.failed' : 'discord.command',
                        error: commandError
                    });
                }
            }
        }
    } else if (int.type === InteractionType.MESSAGE_COMPONENT) {
        if (int.data.custom_id!.startsWith('$a$')) {
            return actionHandler.executeAction(int.data.custom_id!, int.user.id, int);
        } else {
            logger.logDiscord(int).catch(() => undefined);
            const component = components.get(int.component!.name);

            if (!component) {
                await int.acknowledge(true);
                logger.logInteractionResult(int, { execution_ms: 0, event: 'discord.component.rejected' });
                return await int.reply({
                    content: localization(int.language, 'cmd-interaction|command-not-found')
                });
            } else {
                if (component.ownerOnly && int.user.id !== process.env.OWNER_ID) {
                    await int.acknowledge(true);
                    logger.logInteractionResult(int, { execution_ms: 0, event: 'discord.component.rejected' });
                    return await int.reply({
                        content: localization(int.language, 'cmd-interaction|owner-only')
                    });
                } else {
                    if (!component.doNotAcknowledge) {
                        switch (component.category) {
                            case Command_Category.GENERAL:
                                await int.acknowledge(int.kami_user?.secret_general);
                                break;
                            case Command_Category.INSANITY:
                                await int.acknowledge(int.kami_user?.secret_insan);
                                break;
                            case Command_Category.ROLL:
                                await int.acknowledge(int.kami_user?.secret_roll);
                                break;
                            case Command_Category.SHEET_ALTER:
                                await int.acknowledge(int.kami_user?.secret_sheet);
                                break;
                            case Command_Category.SHEET_SEND:
                                await int.acknowledge(int.kami_user?.secret_sheet);
                                break;
                            default:
                                await int.acknowledge();
                                break;
                        }
                    }

                    let componentError: unknown;
                    let componentFailed = false;

                    int.startCommandTimer();

                    try {
                        await component.run(int, int.language);
                        commandsStatistics.logComponent({
                            componentName: component.name,
                            userId: int.kami_user?.id || 0,
                            status: 'SUCCESS',
                            source_system: 'INTERACTION_API'
                        });

                        await announcements.announce(int);
                    } catch (err) {
                        componentError = err;
                        componentFailed = true;
                        logger.error(err, { event: 'discord.component.error', action: component.name });
                        commandsStatistics.logComponent({
                            componentName: component.name,
                            userId: int.kami_user?.id || 0,
                            status: 'FAILED',
                            source_system: 'INTERACTION_API'
                        });
                        await int.reply({
                            content: localization(int.language, 'cmd-interaction|command-error')
                        });
                    } finally {
                        const executionMs = int.stopCommandTimer();
                        record();
                        logger.logInteractionResult(int, {
                            execution_ms: executionMs,
                            event: componentFailed ? 'discord.component.failed' : 'discord.component',
                            error: componentError
                        });
                    }
                }
            }
        }
    } else if (int.type === InteractionType.MODAL_SUBMIT) {
        if (int.data.custom_id && int.data.custom_id.startsWith('$a$')) {
            return actionHandler.executeAction(int.data.custom_id, int.user.id, int);
        } else {
            //TODO: handle modals with custom_id that does not start with $a$
            logger.warn('Modal without registered action not implemented', {
                event: 'discord.modal.unsupported'
            });
            return;
        }
    } else if (int.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
        const command = commands.get(int.data.name);

        if (!command) {
            return logger.error(`Command "${int.data.name}" not found in autocomplete interaction`, {
                event: 'discord.autocomplete.error',
                action: int.data.name
            });
        } else {
            if (command.autocomplete) {
                await command.autocomplete(int, int.language);
            } else {
                return logger.error(
                    `Command "${command.commandNames[Available_Languages['en-us']]}" does not have an autocomplete method`,
                    {
                        event: 'discord.autocomplete.error',
                        action: command.commandNames[Available_Languages['en-us']]
                    }
                );
            }
        }
    }
});

export default router;
