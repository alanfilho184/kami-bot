import { InteractionResponseFlags } from 'discord-interactions';
import { Interaction } from '../resources/utils/interaction-handler';
import { EmbedBuilder } from '@discordjs/builders';
import { Announcement_Mode } from '../types/enums';
import config from '../configs/config';
import logger from '../configs/logger';
import AnnouncementController from '../controllers/announcement.controller';

const GLOBAL_COOLDOWN_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

class Announcements {
    async announce(int: Interaction): Promise<void> {
        try {
            const userId = int.kami_user?.id;

            if (!userId) {
                return;
            }

            const active = await AnnouncementController.getActive();

            if (active.length === 0) {
                return;
            }

            const seen = await AnnouncementController.getUserSeen(
                userId,
                active.map(announcement => announcement.id)
            );
            const seenById = new Map(seen.map(entry => [entry.announcement_id, entry]));
            const now = Date.now();

            let lastAnySeenAt = 0;
            for (const entry of seen) {
                const seenAt = new Date(entry.last_seen_date).getTime();
                if (seenAt > lastAnySeenAt) {
                    lastAnySeenAt = seenAt;
                }
            }

            if (lastAnySeenAt > 0 && now - lastAnySeenAt < GLOBAL_COOLDOWN_MS) {
                return;
            }

            const eligible = active.filter(announcement => {
                const seenEntry = seenById.get(announcement.id);

                if (announcement.mode === Announcement_Mode.ALWAYS) {
                    return true;
                }

                if (announcement.mode === Announcement_Mode.ONCE) {
                    return !seenEntry;
                }

                if (announcement.mode === Announcement_Mode.INTERVAL) {
                    if (!seenEntry) {
                        return true;
                    }

                    if (!announcement.repeat_interval_hours || announcement.repeat_interval_hours <= 0) {
                        logger.warn(
                            `Announcement ${announcement.id} is INTERVAL but has no valid repeat_interval_hours`,
                            {
                                event: 'announcement.interval_invalid',
                                action: String(announcement.id)
                            }
                        );
                        return false;
                    }

                    const lastSeenAt = new Date(seenEntry.last_seen_date).getTime();
                    return now - lastSeenAt >= announcement.repeat_interval_hours * HOUR_MS;
                }

                return false;
            });

            if (eligible.length === 0) {
                return;
            }

            const chosen = eligible[0];
            const embed = this.buildAnnouncementEmbed(int.language, chosen);

            if (!embed) {
                return;
            }

            await int.followUp({
                embeds: [embed],
                flags: InteractionResponseFlags.EPHEMERAL
            });

            await AnnouncementController.markSeen(userId, chosen.id);
        } catch (err) {
            logger.error(err, { event: 'announcement.send_failed' });
        }
    }

    private buildAnnouncementEmbed(language: Available_Languages, announcement: Announcement) {
        const content = announcement.content as Announcement_Content | null;

        if (!content || typeof content !== 'object') {
            return null;
        }

        const normalizedLanguage = `${language}`.toLowerCase().replace('_', '-');
        const localization =
            content[normalizedLanguage] ?? content['pt-br'] ?? content['en-us'] ?? Object.values(content)[0];

        if (!localization || typeof localization.title !== 'string' || typeof localization.description !== 'string') {
            logger.warn(
                `Announcement ${announcement.id} has invalid content for language "${normalizedLanguage}"`,
                {
                    event: 'announcement.invalid_content',
                    action: String(announcement.id),
                    language: normalizedLanguage
                }
            );
            return null;
        }

        const embed = new EmbedBuilder()
            .setTitle(localization.title.slice(0, 256))
            .setDescription(localization.description.slice(0, 4096))
            .setColor(parseInt(config.EMBED_COLOR));

        if (typeof localization.link === 'string' && /^https?:\/\/.+/i.test(localization.link)) {
            embed.setURL(localization.link.slice(0, 512));
        }

        return embed;
    }
}

const announcements = new Announcements();

export default announcements;
