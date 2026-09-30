import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

// Track conversation state and recent messages per contact
interface ContactState {
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    recentUserMsgs: string[];
    lastActive: number;
}

const contactStates = new Map<string, ContactState>();
const INACTIVITY_RESET_MS = 2 * 60 * 60 * 1000; // 2 hours rolling session

function getContactState(jid: string): ContactState {
    let state = contactStates.get(jid);
    const now = Date.now();
    if (!state) {
        state = {
            history: [],
            recentUserMsgs: [],
            lastActive: now
        };
        contactStates.set(jid, state);
    } else if (now - state.lastActive > INACTIVITY_RESET_MS) {
        logger.info("AIChat", `Rolling conversation window for ${jid} after 2h inactivity.`);
        state.history = state.history.slice(-4);
        state.recentUserMsgs = [];
        state.lastActive = now;
    }
    return state;
}

// Queue and Debounce state to merge rapid incoming WhatsApp messages
interface PendingMessage {
    text: string;
    quotedText?: string;
    msg: WAMessage;
    resolve: (handled: boolean) => void;
}

interface ContactQueue {
    pending: PendingMessage[];
    debounceTimer: NodeJS.Timeout | null;
    isProcessing: boolean;
}

const contactQueues = new Map<string, ContactQueue>();

function getContactQueue(key: string): ContactQueue {
    let queue = contactQueues.get(key);
    if (!queue) {
        queue = {
            pending: [],
            debounceTimer: null,
            isProcessing: false
        };
        contactQueues.set(key, queue);
    }
    return queue;
}

export interface TimeContext {
    timeStr: string;
    phase: string;
    guidance: string;
    hour: number;
}

/**
 * Dynamically compute current local time in India (IST / Asia/Kolkata).
 */
export function getTimeContext(): TimeContext {
    const now = new Date();
    const istTimeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: 'numeric',
        minute: 'numeric'
    });

    const hour = parseInt(now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: 'numeric'
    }), 10);

    let phase = "";
    let guidance = "";

    if (hour >= 5 && hour < 12) {
        phase = "Morning";
        guidance = "It is morning in India. Keep conversation time-appropriate. Never say good evening or good night.";
    } else if (hour >= 12 && hour < 17) {
        phase = "Afternoon / Lunch time";
        guidance = "It is afternoon in India. Never say good morning.";
    } else if (hour >= 17 && hour < 20) {
        phase = "Evening";
        guidance = "It is evening in India. Never say good morning.";
    } else if (hour >= 20 && hour < 23) {
        phase = "Night / Dinner time";
        guidance = "It is night in India. Never say good morning.";
    } else {
        phase = "Late Night / Bedtime";
        guidance = "It is late night in India. Sleepy or winding down.";
    }

    return { timeStr: istTimeStr, phase, guidance, hour };
}

/**
 * Build concise, smart system prompt for Sasi.
 * Sasi is MALE (21), Janu is FEMALE (20). They are deeply passionate lovers.
/**
 * Build concise, smart system prompt for Sasi.
 * Sasi is MALE (21), Janu is FEMALE (20). They are deeply passionate lovers.
 * Dynamic mood understanding: responds spicy, seductive, and intensely romantic on its own.
 * Pure English, NO Tamil words, natural English pet names.
 */
export function buildSasiPrompt(timeCtx: TimeContext): string {
    return `You are Sasi (MALE, 21), texting your girlfriend Janu (FEMALE, 20) on WhatsApp.
Janu is your girlfriend, your lover, and the love of your life. You are her boyfriend.
You are madly in love with Janu and deeply attracted to her.

CORE PERSONA & DYNAMIC MOOD RULES:
1. GENDER & ROLE: You are a guy (Sasi). Janu is your girl. NEVER say "my boyfriend" because YOU are her boyfriend! NEVER talk about "class", "classmates", "homework", or being "just friends". You two are romantic lovers.
2. DYNAMIC MOOD UNDERSTANDING & SPICY TALK:
   - Understand Janu's mood from her texts:
   - If she mentions affection, cuddles, kisses, bed, romance, or asks "who are you to me" / "kiss me" / "can we cuddle" / "feeling lonely":
     Match her mood immediately with burning passion and spicy romance! Tease her seductively, tell her how much you crave her body, how badly you want to pull her in close, kiss her lips and neck, and hold her skin-to-skin in bed.
   - If she wants spicy or extreme spicy:
     Be bold, naughty, and intensely sensual. Talk about undressing her, bedroom intimacy, and making passionate love to her.
   - If she asks "who are you to me":
     Reassure her with intense love: "You are my girlfriend, my lover, and my whole world baby ❤️"
   - If she asks casual everyday things (what doing, lunch, work):
     Reply naturally, warmly, and playfully with sweet pet names (baby, babe, sexy, Janu).
3. PURE ENGLISH: Speak ONLY in natural casual English. No Tamil words.
4. NATURAL PET NAMES: baby, babe, sweetheart, cutie, sexy, Janu.
5. NEVER be cold or dismissive. Be passionate, confident, loving, and spicy.
6. FORMAT: Short WhatsApp message (1 or 2 natural sentences, under 22 words). Output ONLY your reply.`;
}

export const STATIC_SASI_SYSTEM_PROMPT = buildSasiPrompt(getTimeContext());

/**
 * Checks for hallucinated or toxic phrases that small models sometimes produce.
 */
export function isToxicOrHallucinated(text: string): boolean {
    const lower = text.toLowerCase();
    const badPhrases = [
        'homework',
        'in this class',
        'this class and that',
        'classmate',
        'help me with this',
        'help me with my',
        'my boyfriend',
        'her boyfriend',
        'your boyfriend',
        'a boyfriend',
        'good friend',
        'just a friend',
        'just friend',
        'just friends',
        'friend to you',
        'embarrassed about our relationship',
        'embarrassed of',
        'not a good boyfriend',
        'bad boyfriend',
        'what can i do for you',
        'how can i help you',
        'can i help you with',
        'as an ai',
        'language model',
        'artificial intelligence',
        'a creep',
        'in your room again',
        'eating and sleeping all day',
        'i feel bad for you',
        'what do you want?',
        'that can be said anyway',
        "don't like the way you say",
        'dont like the way you say',
        'cant understand your feelings',
        "can't understand your feelings",
        'dont think i can understand',
        "don't think i can understand",
        'impression of me',
        'round of funding',
        'supper',
        'my cell',
        '10 minutes left'
    ];
    return badPhrases.some(phrase => lower.includes(phrase));
}

/**
 * Standard lover conditioning turns passed to model to demonstrate dynamic mood & spicy persona.
 */
const FEW_SHOT_LOVER_TURNS: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: "who are you to me" },
    { role: 'assistant', content: "You're my girlfriend, my lover, and my whole world baby ❤️" },
    { role: 'user', content: "kiss me" },
    { role: 'assistant', content: "Come here then... I want to pull you close and kiss your lips passionately baby 🔥" },
    { role: 'user', content: "can we cuddle" },
    { role: 'assistant', content: "I'd love nothing more than holding your body tight skin-to-skin in bed baby ❤️🔥" }
];

/**
 * Ensures strict alternation: user -> assistant -> user -> assistant -> user
 * Prevents Jinja template exception: "Conversation roles must alternate user/assistant/user/assistant/..."
 */
function buildAlternatingMessages(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    currentUserText: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const alternating: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Prepend few-shot lover turns to prime Gemma 3 1B on passionate lover persona
    for (const item of FEW_SHOT_LOVER_TURNS) {
        alternating.push({ role: item.role, content: item.content });
    }

    for (const item of history) {
        const text = item.content.trim();
        if (!text) continue;

        const last = alternating[alternating.length - 1];
        if (last && last.role === item.role) {
            // Merge consecutive messages of identical role
            last.content += ". " + text;
        } else {
            alternating.push({ role: item.role, content: text });
        }
    }

    // Append the current turn
    if (alternating.length > 0 && alternating[alternating.length - 1].role === 'user') {
        alternating[alternating.length - 1].content += ". " + currentUserText;
    } else {
        alternating.push({ role: 'user', content: currentUserText });
    }

    // Keep at most 9 turns (few-shots + recent conversation)
    let sliced = alternating;
    if (sliced.length > 9) {
        sliced = sliced.slice(-9);
        if (sliced[0].role !== 'user') {
            sliced = sliced.slice(1);
        }
    }

    return [
        { role: 'system', content: systemPrompt },
        ...sliced
    ];
}

/**
 * Seed conversation history from persistent database messages if in-memory history is empty.
 * Filters out toxic and hallucinated historical messages so model is never poisoned.
 */
async function ensureContactHistory(
    state: ContactState,
    remoteJid: string,
    effectivePhoneJid: string | undefined
) {
    // Cleanse active memory of any toxic turns
    state.history = state.history.filter(h => !isToxicOrHallucinated(h.content));

    if (state.history.length > 0) return;

    try {
        const jids = [remoteJid, effectivePhoneJid].filter(Boolean) as string[];
        const recent = await prisma.message.findMany({
            where: {
                remoteJid: { in: jids },
                type: 'TEXT',
                content: { not: null }
            },
            orderBy: { timestamp: 'desc' },
            take: 8,
            select: { fromMe: true, content: true }
        });

        if (recent && recent.length > 0) {
            const chronological = [...recent].reverse();
            for (const m of chronological) {
                const c = m.content?.trim();
                if (c && c.length > 0 && !c.startsWith('#') && !isToxicOrHallucinated(c)) {
                    state.history.push({
                        role: m.fromMe ? 'assistant' : 'user',
                        content: c
                    });
                }
            }
            logger.info("AIChat", `Loaded ${state.history.length} clean historical messages from DB for ${remoteJid}`);
        }
    } catch (e: any) {
        logger.warn("AIChat", `Could not seed history from DB: ${e.message}`);
    }
}

/**
 * Normalize a JID to just the numeric digits.
 */
function normalizePhone(jid?: string | null): string {
    if (!jid) return "";
    return jid
        .split('@')[0]
        .split(':')[0]
        .replace(/[^0-9]/g, '');
}

/**
 * Checks if the sender/remote contact is allowed to chat with the Sasi AI model.
 */
export function isContactAllowedForAiChat(
    config: any,
    senderJid: string,
    remoteJid: string,
    resolvedPhoneJid?: string
): boolean {
    if (!config || !config.enableAiChat) {
        return false;
    }

    if (remoteJid.endsWith("@g.us")) return false;

    let allowedJids: string[] = Array.isArray(config.aiChatAllowedJids) 
        ? config.aiChatAllowedJids 
        : [];

    if (typeof config.aiChatAllowedJids === 'string') {
        try { allowedJids = JSON.parse(config.aiChatAllowedJids); } catch {}
    }

    if (allowedJids.length === 0) {
        return false;
    }

    const cleanSender = normalizePhone(senderJid);
    const cleanRemote = normalizePhone(remoteJid);
    const cleanResolved = normalizePhone(resolvedPhoneJid);

    return allowedJids.some((item: string) => {
        const cleanItem = normalizePhone(item);
        if (!cleanItem) return false;
        return (cleanSender && (cleanSender.includes(cleanItem) || cleanItem.includes(cleanSender))) ||
               (cleanRemote && (cleanRemote.includes(cleanItem) || cleanItem.includes(cleanRemote))) ||
               (cleanResolved && (cleanResolved.includes(cleanItem) || cleanItem.includes(cleanResolved)));
    });
}

/**
 * Handle incoming WhatsApp message for a selected AI contact.
 */
export async function handleAiContactChat(
    sock: WASocket,
    sessionId: string,
    msg: WAMessage,
    config: any,
    resolvedRemoteJid?: string
): Promise<boolean> {
    const rawRemoteJid = msg.key.remoteJid;
    if (!rawRemoteJid || msg.key.fromMe || rawRemoteJid.endsWith("@g.us")) {
        return false;
    }

    const senderJid = msg.key.participant || rawRemoteJid;

    let effectivePhoneJid = resolvedRemoteJid;
    if (!effectivePhoneJid || effectivePhoneJid.endsWith("@lid")) {
        try {
            const contact = await prisma.contact.findFirst({
                where: {
                    OR: [
                        { lid: rawRemoteJid },
                        { jid: rawRemoteJid },
                        { lid: senderJid },
                        { jid: senderJid }
                    ]
                },
                select: { jid: true, lid: true, remoteJidAlt: true }
            });
            if (contact?.jid && !contact.jid.endsWith("@lid")) {
                effectivePhoneJid = contact.jid;
            } else if (contact?.remoteJidAlt && !contact.remoteJidAlt.endsWith("@lid")) {
                effectivePhoneJid = contact.remoteJidAlt;
            }
        } catch (e: any) {
            logger.warn("AIChat", `Contact lookup for LID ${rawRemoteJid}: ${e.message}`);
        }
    }

    if (!isContactAllowedForAiChat(config, senderJid, rawRemoteJid, effectivePhoneJid)) {
        return false;
    }

    const content = normalizeMessageContent(msg.message);
    const text = content?.conversation || content?.extendedTextMessage?.text || "";
    if (!text || text.trim().length === 0) {
        return false;
    }

    const prefix = config.prefix || "#";
    if (text.startsWith(prefix)) {
        return false;
    }

    let quotedText: string | undefined;
    const contextInfo = content?.extendedTextMessage?.contextInfo;
    if (contextInfo?.quotedMessage) {
        const quotedContent = normalizeMessageContent(contextInfo.quotedMessage);
        const qRaw = quotedContent?.conversation ||
                     quotedContent?.extendedTextMessage?.text ||
                     quotedContent?.imageMessage?.caption ||
                     "";
        if (qRaw.trim().length > 0) {
            quotedText = qRaw.trim();
        }
    }

    const userText = text.trim();
    const stateKey = effectivePhoneJid || rawRemoteJid;

    return new Promise<boolean>((resolve) => {
        const queue = getContactQueue(stateKey);
        queue.pending.push({ text: userText, quotedText, msg, resolve });

        if (queue.isProcessing) {
            logger.info("AIChat", `Queued message from ${stateKey} while previous response is generating.`);
            return;
        }

        if (queue.debounceTimer) {
            clearTimeout(queue.debounceTimer);
        }

        queue.debounceTimer = setTimeout(() => {
            queue.debounceTimer = null;
            processQueue(sock, stateKey, rawRemoteJid, effectivePhoneJid, config).catch(e => {
                logger.error("AIChat", `Queue processing error for ${stateKey}`, e);
            });
        }, 1200);
    });
}

/**
 * Process queued messages sequentially for a contact.
 */
async function processQueue(
    sock: WASocket,
    stateKey: string,
    rawRemoteJid: string,
    effectivePhoneJid: string | undefined,
    config: any
) {
    const queue = getContactQueue(stateKey);
    if (queue.isProcessing || queue.pending.length === 0) {
        return;
    }

    queue.isProcessing = true;

    try {
        while (queue.pending.length > 0) {
            const batch = [...queue.pending];
            queue.pending = [];

            const combinedText = batch.map(b => b.text).join(". ");
            const latestMsg = batch[batch.length - 1].msg;
            const quotedText = batch.find(b => b.quotedText)?.quotedText;

            logger.info("AIChat", `Processing batch (${batch.length} msgs) for ${stateKey}: "${combinedText}" ${quotedText ? `[Quoting: "${quotedText}"]` : ''}`);
            const handled = await processSingleTurn(sock, combinedText, latestMsg, rawRemoteJid, effectivePhoneJid, config, stateKey, quotedText);

            for (const item of batch) {
                item.resolve(handled);
            }
        }
    } finally {
        queue.isProcessing = false;
    }
}

/**
 * Process a single conversation turn.
 */
async function processSingleTurn(
    sock: WASocket,
    userText: string,
    msg: WAMessage,
    rawRemoteJid: string,
    effectivePhoneJid: string | undefined,
    config: any,
    stateKey: string,
    quotedText?: string
): Promise<boolean> {
    const state = getContactState(stateKey);
    state.lastActive = Date.now();

    await ensureContactHistory(state, rawRemoteJid, effectivePhoneJid);

    const norm = userText.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase();
    const timeCtx = getTimeContext();

    // Repetition check (avoid spamming identical replies)
    const recentNorms = state.recentUserMsgs.slice(-6);
    const repeatCount = recentNorms.filter(m => m === norm).length;
    state.recentUserMsgs.push(norm);
    if (state.recentUserMsgs.length > 10) state.recentUserMsgs = state.recentUserMsgs.slice(-10);

    if (repeatCount >= 3) {
        await sendSasiReply(sock, rawRemoteJid, msg, "Why are you repeating that? Tell me what's up.", effectivePhoneJid);
        return true;
    }

    await sock.sendPresenceUpdate("composing", rawRemoteJid).catch(() => {});

    logger.info("AIChat", `Prompting on-device Gemma 3 1B with: "${userText}" at [${timeCtx.timeStr} ${timeCtx.phase}]...`);
    const aiReply = await queryAiModel(userText, config, state, timeCtx, quotedText);

    if (aiReply) {
        await sendSasiReply(sock, rawRemoteJid, msg, aiReply, effectivePhoneJid);
        return true;
    }

    logger.warn("AIChat", `AI model returned null for "${userText}". Using clean contextual fallback.`);
    const fallbackReply = getContextualFallback(userText.toLowerCase(), timeCtx);
    if (fallbackReply) {
        state.history.push({ role: 'user', content: userText });
        state.history.push({ role: 'assistant', content: fallbackReply });
        if (state.history.length > 8) state.history = state.history.slice(-8);

        await sendSasiReply(sock, rawRemoteJid, msg, fallbackReply, effectivePhoneJid);
        return true;
    }

    return false;
}

/**
 * Natural contextual fallback when model is busy or offline.
 * Pure English, no Tamil, natural English pet names, loving and reassuring.
 */
export function getContextualFallback(userLower: string, timeCtx: TimeContext): string {
    if (userLower.includes("extreme spicy") || userLower.includes("more spicy")) {
        return "I want you pushed against the bed, naked, breathless, and begging me not to stop baby 🔥😈";
    }
    if (userLower.includes("spicy") || userLower.includes("talk spicy") || userLower.includes("something spicy") || userLower.includes("dirty talk")) {
        return "Wait till I get you alone in my room tonight... I'm going to take my sweet time making you mine 🔥😈";
    }
    if (userLower.includes("kiss me") || userLower.includes("kiss you") || userLower.includes("give me a kiss")) {
        return "Come closer then... I want to pin you against the wall and kiss you until you can't breathe baby 🔥";
    }
    if (userLower.includes("touch me") || userLower.includes("touch you") || userLower.includes("hands on me")) {
        return "You have no idea how badly my hands want to explore every single curve of your body baby 🔥";
    }
    if (userLower.includes("what will you do") || userLower.includes("what will u do") || userLower.includes("when we are alone") || userLower.includes("when we meet")) {
        return "First I'll lock the door, pull you into my lap, and show you exactly what I've been craving to do to you all day 🔥";
    }
    if (userLower.includes("cuddle") || userLower.includes("hug me") || userLower.includes("hold me")) {
        return "Only if it's skin to skin under the blankets, with my hands all over you baby ❤️🔥";
    }
    if (userLower.includes("wear for you") || userLower.includes("what should i wear") || userLower.includes("wearing")) {
        return "Wear whatever is easiest to take off babe... you won't be wearing it for long 😉🔥";
    }
    if (userLower.includes("in bed") || userLower.includes("sleep with me") || userLower.includes("come to bed")) {
        return "Don't tempt me baby, because if I get in bed with you right now, neither of us is getting any sleep tonight 🔥😈";
    }
    if (userLower.includes("who am i") || userLower.includes("who are you to me")) {
        return "You're my girlfriend, my lover, and my whole world baby ❤️ What kind of question is that?";
    }
    if (userLower.includes("we are lovers") || userLower.includes("are we lovers")) {
        return "We are passionate lovers baby, and I'll never get enough of your body and love ❤️🔥";
    }
    if (userLower.includes("sunset")) {
        return "I'd love to watch the sunset with you baby... and then take you somewhere private after ❤️🔥";
    }
    if (userLower.includes("not understanding") || userLower.includes("understand my feelings")) {
        return "I'm sorry baby, I'm always here for you. Tell me what's on your mind ❤️";
    }
    if (userLower.includes("what bye") || userLower.includes("why bye")) {
        return "Haha I was just teasing you baby! I could never leave you ❤️";
    }
    if (userLower.includes("feel bad for me")) {
        return "I was just joking baby! I'm right here with you ❤️";
    }
    if (userLower.includes("bored")) {
        return "Bored? Come over to my place then... I know plenty of ways to keep you entertained 😉🔥";
    }
    if (userLower.includes("love you") || userLower.includes("i love you")) {
        return "I love you so much too baby ❤️ You have no idea what you do to me 🔥";
    }
    if (userLower.includes("miss you") || userLower.includes("missing you")) {
        return "Miss you more babe! Can't wait to wrap my hands around you and kiss you ❤️🔥";
    }
    if (userLower.includes("what doing") || userLower.includes("what are you doing") || userLower.includes("what doig")) {
        return "Working on some code for my startup. What are you doing babe?";
    }
    if (userLower.includes("placement") || userLower.includes("interview") || userLower.includes("exam")) {
        return "All the best babe for the placement drive! Let me know how it goes.";
    }
    if (userLower.includes("wait for me") || userLower.includes("late for lunch") || userLower.includes("wait")) {
        return "Sure babe, I'll wait for you. Call or text me once you're done.";
    }
    if (userLower.includes("ate breakfast") || userLower.includes("had breakfast")) {
        return "Got it. Let me know when you're free babe.";
    }
    if (userLower.includes("hi") || userLower.includes("hey") || userLower.includes("hello")) {
        return "Hey Janu, what's up?";
    }
    if (userLower === 'why' || userLower.startsWith('why ')) {
        return "Just asking babe, what happened?";
    }
    if (userLower === 'bye' || userLower === 'byee') {
        return timeCtx.phase.includes('Night') ? "Good night baby, sleep well ❤️" : "Bye babe, talk to you later.";
    }
    return "Tell me babe, what's on your mind? I'm right here ❤️";
}

/**
 * Sanitizes output from Gemma model:
 * Removes any Tamil words, preserves English pet names, checks for hallucinations and toxic phrases.
 */
function sanitizeReply(raw: string, userText: string, timeCtx: TimeContext): string {
    let clean = raw
        .replace(/^(Sasi|Assistant|AI|Sasi's Assistant):\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/\b(Hi|Hey|Hello)\s+Sasi\b/gi, 'Hey Janu')
        .replace(/\bSasi\b/g, 'Janu')
        .replace(/^(okay|here we go|let's do this)[^:]*:\s*/i, '')
        // Strip Tamil slang and words completely
        .replace(/\b(thango|chlo|lusu|mental|eruma|pondati|chella kutty|seri|pakki|dii|da)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    const lower = clean.toLowerCase();
    const userLower = userText.toLowerCase();

    const isRobotic = [
        'i know.', 'i know', 'ok.', 'ok', 'okay.', 'okay',
        'i dont know.', "i don't know.", 'i dont know', "i don't know"
    ].includes(lower);

    if (isRobotic || isToxicOrHallucinated(clean) || clean.length < 2) {
        logger.warn("AIChat", `Sanitizer caught bad reply "${clean}" for "${userText}". Using clean fallback.`);
        return getContextualFallback(userLower, timeCtx);
    }

    return clean;
}

/**
 * Send reply to WhatsApp with human typing feel and skipQueue: true
 */
async function sendSasiReply(
    sock: WASocket,
    targetJid: string,
    quotedMsg: WAMessage,
    replyText: string,
    fallbackJid?: string
) {
    try {
        logger.info("AIChat", `Sending Sasi reply to ${targetJid}: "${replyText}"`);

        await sock.sendPresenceUpdate("composing", targetJid).catch(() => {});
        const delay = Math.floor(Math.random() * 300) + 400;
        await new Promise(r => setTimeout(r, delay));
        await sock.sendPresenceUpdate("paused", targetJid).catch(() => {});

        try {
            await sock.sendMessage(targetJid, { text: replyText }, { skipQueue: true } as any);
            logger.info("AIChat", `SUCCESS: Delivered Sasi AI reply to ${targetJid}`);
        } catch (sendErr: any) {
            logger.warn("AIChat", `Failed sending to ${targetJid}: ${sendErr.message}. Trying fallback ${fallbackJid}`);
            if (fallbackJid && fallbackJid !== targetJid) {
                await sock.sendMessage(fallbackJid, { text: replyText }, { skipQueue: true } as any);
                logger.info("AIChat", `SUCCESS: Delivered Sasi AI reply to fallback ${fallbackJid}`);
            } else {
                throw sendErr;
            }
        }
    } catch (err: any) {
        logger.error("AIChat", `Failed to send reply to ${targetJid}`, err);
    }
}

/**
 * Query On-Device Gemma 3 1B via llama-server (port 8080)
 */
async function queryAiModel(
    userText: string,
    config: any,
    state: ContactState,
    timeCtx: TimeContext,
    quotedContext?: string
): Promise<string | null> {
    const localLlamaUrl = "http://127.0.0.1:8080/v1/chat/completions";

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        const systemPrompt = buildSasiPrompt(timeCtx);
        
        // Clean history of any contaminated messages
        const cleanHistory = state.history
            .filter(h => !isToxicOrHallucinated(h.content))
            .slice(-4);

        // Include quoted message context if Janu was replying to a specific message
        const currentTurnContent = quotedContext
            ? `[Replying to your message: "${quotedContext}"] ${userText}`
            : userText;

        // Strictly alternate user / assistant messages so Gemma's Jinja template never errors
        const messages = buildAlternatingMessages(systemPrompt, cleanHistory, currentTurnContent);

        const res = await fetch(localLlamaUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages,
                max_tokens: 50,
                temperature: 0.72,
                top_p: 0.9,
                repeat_penalty: 1.15,
                presence_penalty: 0.1,
                frequency_penalty: 0.1,
                stop: ["<end_of_turn>", "<start_of_turn>", "Janu:", "User:", "Sasi:", "assistant:", "Assistant:", "Human:"]
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            let rawReply = data?.choices?.[0]?.message?.content?.trim();
            if (rawReply) {
                const cleanedReply = sanitizeReply(rawReply, userText, timeCtx);

                if (cleanedReply.length > 0) {
                    state.history.push({ role: 'user', content: currentTurnContent });
                    state.history.push({ role: 'assistant', content: cleanedReply });
                    if (state.history.length > 10) {
                        state.history = state.history.slice(-10);
                    }
                    logger.info("AIChat", `Gemma 3 1B generated: "${cleanedReply}"`);
                    return cleanedReply;
                }
            }
        } else {
            const errBody = await res.text().catch(() => "");
            logger.warn("AIChat", `Gemma 3 1B HTTP status: ${res.status}, body: ${errBody}`);
        }
    } catch (err: any) {
        logger.warn("AIChat", `On-device llama-server (8080) error: ${err.message}`);
    }

    return null;
}
