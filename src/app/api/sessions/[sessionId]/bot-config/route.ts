import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // @ts-ignore
        const session = await (prisma as any).session.findFirst({
            where: {
                OR: [
                    { sessionId },
                    { id: sessionId }
                ]
            },
            select: { id: true, botConfig: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const raw = session.botConfig || {};
        const safeBotConfig = {
            enabled: raw.enabled ?? true,
            botMode: raw.botMode || 'OWNER',
            botAllowedJids: Array.isArray(raw.botAllowedJids) ? raw.botAllowedJids : [],
            botBlockedJids: Array.isArray(raw.botBlockedJids) ? raw.botBlockedJids : [],
            autoReplyMode: raw.autoReplyMode || 'ALL',
            autoReplyAllowedJids: Array.isArray(raw.autoReplyAllowedJids) ? raw.autoReplyAllowedJids : [],
            autoReplyBlockedJids: Array.isArray(raw.autoReplyBlockedJids) ? raw.autoReplyBlockedJids : [],
            enableSticker: raw.enableSticker ?? true,
            enablePing: raw.enablePing ?? true,
            enableUptime: raw.enableUptime ?? true,
            enableAi: false,
            aiApiKey: raw.aiApiKey || "",
            aiProvider: "local",
            botName: raw.botName || "WA-AKG Bot",
            removeBgApiKey: raw.removeBgApiKey || "",
            enableVideoSticker: raw.enableVideoSticker ?? true,
            maxStickerDuration: raw.maxStickerDuration ?? 10,
            prefix: raw.prefix || "#",
            antiSpamEnabled: raw.antiSpamEnabled ?? false,
            spamLimit: raw.spamLimit ?? 5,
            spamInterval: raw.spamInterval ?? 10,
            spamDelayMin: raw.spamDelayMin ?? 1000,
            spamDelayMax: raw.spamDelayMax ?? 3000,
            welcomeMessage: raw.welcomeMessage || "",
            autoRead: raw.autoRead ?? false,
            alwaysOnline: raw.alwaysOnline ?? false,
            antiLinkMode: raw.antiLinkMode || "OFF",
            antiLinkAction: raw.antiLinkAction || "DELETE",
            antiLinkLimit: raw.antiLinkLimit ?? 3,
            antiLinkScope: raw.antiLinkScope || "ALL",
            antiLinkGroups: Array.isArray(raw.antiLinkGroups) ? raw.antiLinkGroups : [],
            enableAiChat: raw.enableAiChat ?? false,
            aiChatAllowedJids: Array.isArray(raw.aiChatAllowedJids) ? raw.aiChatAllowedJids : [],
            aiChatEndpoint: raw.aiChatEndpoint || "http://127.0.0.1:8080/v1/chat/completions",
            aiChatProvider: "local",
        };

        return NextResponse.json({ status: true, message: "Bot config fetched successfully", data: safeBotConfig });
    } catch (error) {
        console.error("Get Bot Config Error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });

        const body = await request.json();

        // Find session DB ID
        const session = await prisma.session.findFirst({
            where: {
                OR: [
                    { sessionId },
                    { id: sessionId }
                ]
            },
            select: { id: true }
        });

        if (!session) return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });

        // Build update payload from only provided keys so partial saves
        // (e.g. just toggling `enabled`) don't wipe other fields.
        const updateFields: Record<string, unknown> = {};
        const passthrough = [
            "enabled",
            "botMode",
            "botAllowedJids",
            "botBlockedJids",
            "autoReplyMode",
            "autoReplyAllowedJids",
            "autoReplyBlockedJids",
            "botName",
            "enableSticker",
            "enableVideoSticker",
            "maxStickerDuration",
            "enablePing",
            "enableUptime",
            "prefix",
            "antiSpamEnabled",
            "spamLimit",
            "spamInterval",
            "spamDelayMin",
            "spamDelayMax",
            "welcomeMessage",
            "autoRead",
            "alwaysOnline",
            "antiLinkMode",
            "antiLinkAction",
            "antiLinkLimit",
            "antiLinkScope",
            "antiLinkGroups",
            "enableAi",
            "aiProvider",
            "enableAiChat",
            "aiChatAllowedJids",
            "aiChatEndpoint",
            "aiChatProvider",
        ];
        for (const key of passthrough) {
            if (body[key] !== undefined) updateFields[key] = body[key];
        }
        // removeBgApiKey & aiApiKey: only update if explicitly provided (allow null to clear)
        if (Object.prototype.hasOwnProperty.call(body, "removeBgApiKey")) {
            updateFields.removeBgApiKey = body.removeBgApiKey || null;
        }
        if (Object.prototype.hasOwnProperty.call(body, "aiApiKey")) {
            updateFields.aiApiKey = body.aiApiKey ? body.aiApiKey.trim() : null;
        }

        // Upsert Config
        // @ts-ignore
        const config = await (prisma as any).botConfig.upsert({
            where: { sessionId: session.id },
            create: {
                sessionId: session.id,
                enabled: body.enabled ?? true,
                botMode: body.botMode || 'OWNER',
                botAllowedJids: body.botAllowedJids || [],
                botBlockedJids: body.botBlockedJids || [],
                autoReplyMode: body.autoReplyMode || 'ALL',
                autoReplyAllowedJids: body.autoReplyAllowedJids || [],
                autoReplyBlockedJids: body.autoReplyBlockedJids || [],

                enableSticker: body.enableSticker ?? true,
                enableVideoSticker: body.enableVideoSticker ?? true,
                maxStickerDuration: body.maxStickerDuration || 10,
                enablePing: body.enablePing ?? true,
                enableUptime: body.enableUptime ?? true,
                enableAi: false,
                aiApiKey: null,
                aiProvider: "local",
                removeBgApiKey: body.removeBgApiKey || null,
                prefix: body.prefix || "#",
                antiSpamEnabled: body.antiSpamEnabled ?? false,
                spamLimit: body.spamLimit || 5,
                spamInterval: body.spamInterval || 10,
                spamDelayMin: body.spamDelayMin || 1000,
                spamDelayMax: body.spamDelayMax || 3000,
                welcomeMessage: body.welcomeMessage || null,
                autoRead: body.autoRead ?? false,
                alwaysOnline: body.alwaysOnline ?? false,
                antiLinkMode: body.antiLinkMode || "OFF",
                antiLinkAction: body.antiLinkAction || "DELETE",
                antiLinkLimit: body.antiLinkLimit ?? 3,
                antiLinkScope: body.antiLinkScope || "ALL",
                antiLinkGroups: body.antiLinkGroups || [],
                enableAiChat: body.enableAiChat ?? false,
                aiChatAllowedJids: body.aiChatAllowedJids || [],
                aiChatEndpoint: body.aiChatEndpoint || "http://127.0.0.1:8080/v1/chat/completions",
                aiChatProvider: "local",
            },
            update: updateFields,
        });

        return NextResponse.json({ status: true, message: "Bot config updated successfully", data: config });
    } catch (error) {
        console.error("Update Bot Config Error:", error);
        return NextResponse.json({ status: false, message: "Failed to update config", error: "Failed to update config" }, { status: 500 });
    }
}
