import { logger } from "@/lib/logger";

interface NewsItem {
    title: string;
    description: string;
    link: string;
}

/**
 * Strips HTML tags and unescapes basic HTML entities.
 */
function cleanText(text: string): string {
    return text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Clean tracking query parameters from links for cleaner WhatsApp display.
 */
function cleanLink(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.searchParams.delete("utm_source");
        parsed.searchParams.delete("utm_medium");
        parsed.searchParams.delete("utm_campaign");
        parsed.searchParams.delete("at_medium");
        parsed.searchParams.delete("at_campaign");
        return parsed.toString();
    } catch {
        return url.split("?")[0] || url;
    }
}

/**
 * Fetches and parses an RSS feed using pure string/regex logic (zero external dependencies).
 */
async function fetchRssFeed(url: string, limit = 3): Promise<NewsItem[]> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
            }
        });

        clearTimeout(timeout);

        if (!res.ok) {
            logger.warn("NewsService", `Failed to fetch RSS: ${url} (status: ${res.status})`);
            return [];
        }

        const xml = await res.text();
        const items: NewsItem[] = [];

        // Match <item> blocks
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
        for (const match of itemMatches) {
            if (items.length >= limit) break;
            const block = match[1];

            const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
            const descMatch = block.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/i);
            const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i);

            if (titleMatch && titleMatch[1]) {
                const title = cleanText(titleMatch[1]);
                let desc = descMatch ? cleanText(descMatch[1]) : "";
                
                // Truncate overly long descriptions to ~140 chars
                if (desc.length > 140) {
                    desc = desc.slice(0, 137) + "...";
                }

                // If description is identical to title, leave it empty
                if (desc.toLowerCase() === title.toLowerCase()) {
                    desc = "";
                }

                const link = linkMatch ? cleanLink(linkMatch[1].trim()) : "";

                if (title) {
                    items.push({ title, description: desc, link });
                }
            }
        }

        return items;
    } catch (err: any) {
        logger.error("NewsService", `Error fetching feed ${url}:`, err.message);
        return [];
    }
}

/**
 * Builds a formatted daily morning news digest covering India, World, and Tech/Business.
 */
export async function buildMorningNewsDigest(): Promise<string> {
    const today = new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata"
    });

    // Fetch categories concurrently
    const [indiaResults, worldResults, techResults] = await Promise.allSettled([
        fetchRssFeed("https://www.thehindu.com/news/national/feeder/default.rss", 3),
        fetchRssFeed("https://feeds.bbci.co.uk/news/world/rss.xml", 3),
        fetchRssFeed("https://techcrunch.com/feed/", 3)
    ]);

    const indiaItems = indiaResults.status === "fulfilled" && indiaResults.value.length > 0 
        ? indiaResults.value 
        : [];
    const worldItems = worldResults.status === "fulfilled" && worldResults.value.length > 0 
        ? worldResults.value 
        : [];
    const techItems = techResults.status === "fulfilled" && techResults.value.length > 0 
        ? techResults.value 
        : [];

    let message = `🌅 *MORNING NEWS BRIEFING*\n📅 _${today}_\n\n`;

    // 1. India Top Stories
    message += `🇮🇳 *INDIA TOP STORIES*\n`;
    if (indiaItems.length > 0) {
        for (const item of indiaItems) {
            message += `• *${item.title}*\n`;
            if (item.description) message += `  ↳ ${item.description}\n`;
            if (item.link) message += `  🔗 ${item.link}\n`;
            message += `\n`;
        }
    } else {
        message += `_Unable to refresh India headlines at this moment._\n\n`;
    }

    // 2. Global News
    message += `🌍 *GLOBAL HIGHLIGHTS*\n`;
    if (worldItems.length > 0) {
        for (const item of worldItems) {
            message += `• *${item.title}*\n`;
            if (item.description) message += `  ↳ ${item.description}\n`;
            if (item.link) message += `  🔗 ${item.link}\n`;
            message += `\n`;
        }
    } else {
        message += `_Unable to refresh global headlines at this moment._\n\n`;
    }

    // 3. Tech & Business
    message += `💼 *TECH & BUSINESS*\n`;
    if (techItems.length > 0) {
        for (const item of techItems) {
            message += `• *${item.title}*\n`;
            if (item.description) message += `  ↳ ${item.description}\n`;
            if (item.link) message += `  🔗 ${item.link}\n`;
            message += `\n`;
        }
    } else {
        message += `_Unable to refresh tech headlines at this moment._\n\n`;
    }

    message += `━━━━━━━━━━━━━━━━━━━━\n✨ _Have a productive day ahead!_`;

    return message;
}

/**
 * Sends the morning news briefing to the target WhatsApp recipient.
 */
export async function sendMorningNews(targetJid = "57342326489321@lid", customSocket?: any): Promise<boolean> {
    try {
        let sock = customSocket;

        if (!sock) {
            const { waManager } = await import("@/modules/whatsapp/manager");
            const connectedInstance = waManager.getConnectedInstance();
            if (connectedInstance?.socket) {
                sock = connectedInstance.socket;
            } else {
                const { prisma } = await import("@/lib/prisma");
                const activeSession = await prisma.session.findFirst({
                    where: { status: "CONNECTED" },
                    select: { sessionId: true }
                });
                if (activeSession) {
                    const inst = waManager.getInstance(activeSession.sessionId);
                    if (inst?.socket) sock = inst.socket;
                }
            }
        }

        if (!sock) {
            logger.warn("NewsService", "Cannot send morning news: No active WhatsApp session connected.");
            return false;
        }

        const digest = await buildMorningNewsDigest();
        await sock.sendMessage(targetJid, { text: digest });
        logger.info("NewsService", `Morning news digest successfully sent to ${targetJid}`);
        return true;
    } catch (err: any) {
        logger.error("NewsService", `Failed to send morning news to ${targetJid}:`, err);
        return false;
    }
}
