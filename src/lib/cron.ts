import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { logger } from "./logger";

export function initScheduler() {
    // Run every minute
    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();
            
            // Fetch pending messages due for sending
            const pendingMessages = await prisma.scheduledMessage.findMany({
                where: {
                    status: "PENDING",
                    sendAt: {
                        lte: now
                    }
                },
                include: {
                    session: true
                }
            });

            if (pendingMessages.length === 0) return;

            // Only log if we're actually processing things to reduce noise
            logger.info("Cron", `Found ${pendingMessages.length} messages to send`);

            for (const msg of pendingMessages) {
                const instance = waManager.getInstance(msg.session.sessionId);

                if (!instance || !instance.socket) {
                    logger.warn("Cron", `Session ${msg.session.sessionId} not connected. Skipping.`);
                    // Optionally mark as FAILED or retry later
                    // keeping PENDING will define behavior (retry next minute)
                    // But if session is dead for long time, it piles up.
                    // Let's keep it PENDING for now.
                    continue;
                }

                try {
                    logger.info("Cron", `Sending scheduled message to ${msg.jid}`);
                    
                    if (msg.mediaUrl) {
                        await instance.socket.sendMessage(msg.jid, { 
                            text: msg.content
                        });
                    } else {
                        await instance.socket.sendMessage(msg.jid, { text: msg.content });
                    }

                    // Handle recurring / repeating schedule
                    const repeatType = (msg as any).repeatType || "NONE";
                    if (repeatType !== "NONE") {
                        let intervalDays = (msg as any).repeatInterval || 1;
                        if (repeatType === "DAILY") intervalDays = 1;
                        if (repeatType === "WEEKLY") intervalDays = 7;

                        const nextSendAt = new Date(msg.sendAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
                        const repeatUntil = (msg as any).repeatUntil ? new Date((msg as any).repeatUntil) : null;
                        const currentCount = (msg as any).repeatCount;
                        const nextCount = typeof currentCount === "number" ? currentCount - 1 : null;

                        const isFinished = (repeatUntil && nextSendAt > repeatUntil) || (nextCount !== null && nextCount <= 0);

                        if (isFinished) {
                            await prisma.scheduledMessage.update({
                                where: { id: msg.id },
                                data: {
                                    status: "COMPLETED",
                                    lastSentAt: now,
                                    repeatCount: nextCount !== null ? 0 : null
                                }
                            });
                        } else {
                            await prisma.scheduledMessage.update({
                                where: { id: msg.id },
                                data: {
                                    status: "PENDING",
                                    sendAt: nextSendAt,
                                    lastSentAt: now,
                                    repeatCount: nextCount
                                }
                            });
                        }
                    } else {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: {
                                status: "SENT",
                                lastSentAt: now
                            }
                        });
                    }

                } catch (error) {
                    logger.error("Cron", `Check failed for scheduled message ${msg.id}`, error);
                    await prisma.scheduledMessage.update({
                        where: { id: msg.id },
                        data: { status: "FAILED" }
                    });
                }
            }

        } catch (error: any) {
            const code = error?.code;
            if (["P1001", "P1002", "P1008", "P1017"].includes(code)) {
                logger.warn("Cron", `Database not ready (${code}) — skipping this cycle.`);
            } else {
                logger.error("Cron", "Scheduler error:", error);
            }
        }
    });
    
    // Dynamic Morning News Briefing Job (checks every minute against subscriber delivery times in Asia/Kolkata)
    cron.schedule("* * * * *", async () => {
        try {
            const istDateStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
            const istDate = new Date(istDateStr);
            const currentHours = String(istDate.getHours()).padStart(2, "0");
            const currentMinutes = String(istDate.getMinutes()).padStart(2, "0");
            const currentTimeStr = `${currentHours}:${currentMinutes}`;
            const todayDateStr = `${istDate.getFullYear()}-${String(istDate.getMonth() + 1).padStart(2, "0")}-${String(istDate.getDate()).padStart(2, "0")}`;

            const dueSubscriptions = await prisma.newsSubscription.findMany({
                where: {
                    enabled: true,
                    deliveryTime: currentTimeStr
                }
            });

            if (dueSubscriptions.length === 0) return;

            const { sendMorningNews } = await import("./news-service");

            for (const sub of dueSubscriptions) {
                // Check if already sent today in IST
                if (sub.lastSentAt) {
                    const lastSentIst = new Date(new Date(sub.lastSentAt).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
                    const lastSentDateStr = `${lastSentIst.getFullYear()}-${String(lastSentIst.getMonth() + 1).padStart(2, "0")}-${String(lastSentIst.getDate()).padStart(2, "0")}`;
                    if (lastSentDateStr === todayDateStr) {
                        continue;
                    }
                }

                logger.info("Cron", `Dispatching daily news to ${sub.name || sub.jid} (${sub.jid}) at ${currentTimeStr} IST`);
                const success = await sendMorningNews(sub.jid);
                if (success) {
                    await prisma.newsSubscription.update({
                        where: { id: sub.id },
                        data: { lastSentAt: new Date() }
                    });
                }
            }
        } catch (newsErr) {
            logger.error("Cron", "Failed to run news briefing job:", newsErr);
        }
    });

    logger.info("Cron", "Scheduler initialized (including repeating schedules & dynamic news briefing)");
}
