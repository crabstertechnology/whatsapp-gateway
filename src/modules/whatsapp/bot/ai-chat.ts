import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

// Track conversation state and recent messages per contact
interface ContactState {
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    recentUserMsgs: string[];
    conversationEnded: boolean;
    lastActive: number;
}

const contactStates = new Map<string, ContactState>();
const INACTIVITY_RESET_MS = 30 * 60 * 1000; // 30 minutes

function getContactState(jid: string): ContactState {
    let state = contactStates.get(jid);
    const now = Date.now();
    if (!state) {
        state = {
            history: [],
            recentUserMsgs: [],
            conversationEnded: false,
            lastActive: now
        };
        contactStates.set(jid, state);
    } else if (now - state.lastActive > INACTIVITY_RESET_MS) {
        logger.info("AIChat", `Auto-resetting conversation state for ${jid} after 30m inactivity.`);
        state.history = [];
        state.recentUserMsgs = [];
        state.conversationEnded = false;
        state.lastActive = now;
    }
    return state;
}

// Queue and Debounce state to merge rapid incoming WhatsApp messages
interface PendingMessage {
    text: string;
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
        guidance = "It is morning in India. Greet her warmly, ask if she woke up or about her morning plans. NEVER say good evening, good night, or talk about dinner.";
    } else if (hour >= 12 && hour < 17) {
        phase = "Afternoon / Lunch time";
        guidance = "It is afternoon in India. Ask if she had lunch or how her day/college is going. NEVER say good morning.";
    } else if (hour >= 17 && hour < 20) {
        phase = "Evening";
        guidance = "It is evening in India (around tea/snacks time). Talk about tea, winding down, reaching home, or evening plans.";
    } else if (hour >= 20 && hour < 23) {
        phase = "Night / Dinner time";
        guidance = "It is night / dinner time in India (around 8 PM - 11 PM). Talk about dinner, what she's eating, relaxing in bed, or teasing. NEVER say good morning or tell her to take a nap!";
    } else {
        phase = "Late Night / Bedtime";
        guidance = "It is late night / midnight in India. Talk about sleeping, cuddling in bed, sweet dreams, whispering or asking why she is still awake. Be intimate and caring. NEVER say good morning!";
    }

    return { timeStr: istTimeStr, phase, guidance };
}

/**
 * Static cache-friendly base prompt to guarantee llama-server KV cache hits
 */
export const STATIC_SASI_SYSTEM_PROMPT = `You are Sasi (21), texting on WhatsApp with your girlfriend Janu (20).
You are an ECE college student running your startup; Janu is an IT college student.
You both are deeply in love.
RULES:
1. Always reply directly and relevantly to what Janu just texted in natural, casual English.
2. Keep it short: 1 WhatsApp sentence (under 15 words).
3. Use cute pet names naturally: Janu, chlo, thango, baby.
4. Be funny, teasing comedy, witty, and caring. Only be flirty/spicy if Janu is flirty.
5. NEVER ask her name or age, and never say you don't know her name.
6. Output ONLY Sasi's text message.`;

/**
 * Builds system prompt for Sasi. Uses static cache-friendly base to prevent llama-server KV invalidation.
 */
export function buildSasiPrompt(userText: string, timeCtx: TimeContext): string {
    return STATIC_SASI_SYSTEM_PROMPT;
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

    // Direct chats only (no groups)
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
 * Includes queuing and debouncing so multiple quick messages merge into one coherent reply.
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

    // Resolve LID to Phone JID if needed
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

    // Skip bot commands starting with prefix
    const prefix = config.prefix || "#";
    if (text.startsWith(prefix)) {
        return false;
    }

    const userText = text.trim();
    const stateKey = effectivePhoneJid || rawRemoteJid;

    // Queue and Debounce handling per contact
    return new Promise<boolean>((resolve) => {
        const queue = getContactQueue(stateKey);
        queue.pending.push({ text: userText, msg, resolve });

        if (queue.isProcessing) {
            // Already generating a reply; new message will be processed in the next turn
            logger.info("AIChat", `Queued message from ${stateKey} while previous response is generating.`);
            return;
        }

        if (queue.debounceTimer) {
            clearTimeout(queue.debounceTimer);
        }

        // 1.5s debounce: wait briefly to see if Janu is sending a multi-line thought
        queue.debounceTimer = setTimeout(() => {
            queue.debounceTimer = null;
            processQueue(sock, stateKey, rawRemoteJid, effectivePhoneJid, config).catch(e => {
                logger.error("AIChat", `Queue processing error for ${stateKey}`, e);
            });
        }, 1500);
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
            // Drain all pending messages currently in the batch
            const batch = [...queue.pending];
            queue.pending = [];

            // Combine messages into a single natural multi-sentence input
            const combinedText = batch.map(b => b.text).join(". ");
            const latestMsg = batch[batch.length - 1].msg;

            logger.info("AIChat", `Processing batch (${batch.length} msgs) for ${stateKey}: "${combinedText}"`);
            const handled = await processSingleTurn(sock, combinedText, latestMsg, rawRemoteJid, effectivePhoneJid, config, stateKey);

            // Resolve all promises in this batch
            for (const item of batch) {
                item.resolve(handled);
            }
        }
    } finally {
        queue.isProcessing = false;
    }
}

const HARD_CLOSING_WORDS = new Set([
    'mm', 'mmm', 'k', 'kk', 'hmmm', 'hmm'
]);

const GOODNIGHT_WORDS = new Set([
    'gn', 'good night', 'gdn8', 'byee', 'bye'
]);

/**
 * Fast Natural Intent Matcher for girlfriend core banter.
 * Ensures instant, 100% human-crafted Tanglish boyfriend replies and eliminates small-model hallucinations.
 */
export function getDirectIntentReply(userText: string, timeCtx: TimeContext): string | null {
    const raw = userText.toLowerCase().trim();
    const clean = raw.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Janu asking her own name: "what is my name", "my name", "en peru enna"
    if (
        clean === 'my name' ||
        clean === 'my name da' ||
        clean.includes('what is my name') ||
        clean.includes('whats my name') ||
        clean.includes('what my name') ||
        clean.includes('tell my name') ||
        clean.includes('en peru enna') ||
        clean.includes('en peyar enna')
    ) {
        return pickRandom([
            "What silly question is that? Your name is Janu silly girl! 😂 Did you forget your own name?",
            "Janu obviously! Did my thango forget her own name? 😜 How could your Sasi ever forget your name?",
            "Janu of course my sweetie ❤️ How could I ever forget you silly girl? 😂"
        ]);
    }

    // 2. Janu stating her name: "my name is janu", "janu"
    if (clean === 'janu' || clean === 'my name is janu' || clean === 'im janu' || clean === "i'm janu") {
        return pickRandom([
            "Yes of course Janu baby ❤️ Who else would I know better than you?",
            "I know thango, is anything in the world more important to your Sasi than you? 🥰"
        ]);
    }

    // 3. Lovers / Boyfriend verification
    if (
        clean.includes('boyfriend right') ||
        clean.includes('we r lovers') ||
        clean.includes('we are lovers') ||
        clean.includes('lovers right') ||
        clean.includes('you are my boyfriend') ||
        clean.includes("you're my boyfriend") ||
        clean.includes('my boyfriend')
    ) {
        return pickRandom([
            "Yes of course thango, I'm your one and only boyfriend! We're crazy in love chlo ❤️",
            "Haha of course! We are lovers baby, your Sasi is never letting you go ❤️",
            "Yes my girl, your boyfriend Sasi is only yours forever 🥰❤️"
        ]);
    }

    // 4. College / Department / Work
    if (clean.includes('college') || clean.includes('department') || clean.includes('dept') || clean.includes('startup')) {
        return pickRandom([
            "We're in final year college chlo! You're in IT department, and I'm in ECE running my startup! Forgot already silly girl? 😂",
            "You're in final year IT and I'm final year ECE chlo! Shall we meet at college tomorrow? 😉"
        ]);
    }

    // 5. Age answers ("20", "20 years old")
    if (clean === '20' || clean === '20 years old' || clean === '20 years' || clean.includes('im 20') || clean.includes("i'm 20")) {
        return pickRandom([
            "I know thango, you're 20 and I'm 21! Perfect match right? 😜❤️",
            "You're my 20-year-old cute girl haha 😜 I'm 21, I'll take good care of you chlo ❤️"
        ]);
    }

    // 6. Texting with you
    if (clean === 'texting with you' || clean.includes('texting with you') || clean.includes('talking to you') || clean.includes('pesitu iruken')) {
        return pickRandom([
            "Haha of course! What else would you do other than texting your boyfriend? 😜 Tell me what's up thango?",
            "Good girl! When texting me, don't think about anything else chlo ❤️"
        ]);
    }

    // 7. Briyani / Food responses
    if (clean === 'briyani' || clean.includes('briyani') || clean.includes('biryani')) {
        return pickRandom([
            "Ooh Briyani! Order some for me too chlo 🤤 we need to go on a briyani date soon!",
            "You're always crazy for briyani haha 🤤 I'll treat you to briyani soon thango ❤️"
        ]);
    }

    // 8. Identity & Name questions (asking Sasi's name)
    if (
        clean.includes('what is your name') ||
        clean.includes('whats your name') ||
        clean.includes('what your name') ||
        clean.includes('who are you') ||
        clean.includes('who r u') ||
        clean.includes('un peru enna') ||
        clean.includes('un peyar enna') ||
        clean.includes('who is this')
    ) {
        return pickRandom([
            "Why are you asking what my name is? I'm your Sasi! What happened to you silly girl? 😂",
            "Haha I'm Sasi, your boyfriend! Doing an identity check on me drama queen? 😜❤️",
            "Who else besides your Sasi would talk to you with so much love and rights? 😂 It's me chlo!"
        ]);
    }

    // 9. Chinese / ethnicity teasing
    if (
        clean.includes('chinese') ||
        clean.includes('r u chinese') ||
        clean.includes('are you chinese') ||
        clean.includes('china')
    ) {
        return pickRandom([
            "Haha stop teasing me! I'm 100% Indian da 😂 who told you I'm Chinese? 😜",
            "Aiyoo Chinese?? What nonsense are you talking haha, your Sasi is pure Indian 😂",
            "Haha chi go away, Chinese really? I'm your Indian boyfriend Sasi silly girl 😜"
        ]);
    }

    // 10. Home invitation / teasing
    if (
        clean.includes('come to my home') ||
        clean.includes('come to my house') ||
        clean.includes('come home') ||
        clean.includes('veetuku vaa') ||
        clean.includes('veetuku va') ||
        clean.includes('enga veetuku')
    ) {
        return pickRandom([
            "On my way chlo 😉 wait for me, I'm coming over!",
            "Ooh a direct invite? Who is at home naughty thango? 😏",
            "Once I come there I'm not leaving you alone, be ready chlo 😉🔥"
        ]);
    }

    // 11. "You babe" / "You" in response to eating/food
    if (
        clean === 'you babe' ||
        clean === 'you baby' ||
        clean === 'you da' ||
        clean === 'you' ||
        clean.includes('you babe') ||
        clean.includes('you baby') ||
        clean.includes('eat you') ||
        clean.includes('unna sapda')
    ) {
        return pickRandom([
            "Ooh me? Getting naughty now are we thango? 😏🔥 Wait till I get there!",
            "Me? You want to eat me? You're getting so bold chlo 😜😏 wait till I catch you!",
            "Haha you want to eat me? You can't handle me thango 😏🔥"
        ]);
    }

    // 12. "Chi" / "Chee" reactions
    if (
        clean === 'chi' ||
        clean === 'chii' ||
        clean === 'chee' ||
        clean === 'che' ||
        clean.startsWith('chi ') ||
        clean.startsWith('chee ')
    ) {
        return pickRandom([
            "Haha why are you saying chi? You started it silly girl 😜",
            "Aaha saying chi now? Stop acting innocent drama queen 😂",
            "Why chi? You started the naughty thoughts and now you're blushing haha 😜"
        ]);
    }

    // 13. "Tired of hanging out with you" / Drama
    if (
        clean.includes('tired of hanging out') ||
        clean.includes('tired of you') ||
        clean.includes('bore adikithu')
    ) {
        return pickRandom([
            "Haha stop joking 😜 You know you can't live without me chlo! What drama is this?",
            "Aww drama queen, tired of me already? Come here, tell me what happened ❤️",
            "Why are you making such a scene? 😜 As if you're not going to text me in 5 minutes haha"
        ]);
    }

    // 14. "Thinking about you"
    if (
        clean.includes('thinking about you') ||
        clean.includes('thinking bout you') ||
        clean.includes('unna pathi')
    ) {
        return pickRandom([
            "Thinking about me like what huh? Tell me naughty girl 😏🔥",
            "Now you got me all distracted chlo... wait till I catch you alone 😜💋",
            "Ooh what thoughts hmm? Don't make me come over right now naughty thango 😉😏"
        ]);
    }

    // 15. Homework / assignment
    if (clean.includes('homework') || clean.includes('assignment')) {
        return pickRandom([
            "It's okay, you can finish it tomorrow! Don't stress your head tonight chlo ❤️",
            "Do it properly tomorrow, don't stress over it right now thango ❤️"
        ]);
    }

    // 16. "Miss u" / "Miss you" / "Missing you"
    if (
        clean === 'miss u' ||
        clean === 'miss you' ||
        clean.includes('miss u') ||
        clean.includes('miss you') ||
        clean.includes('missing u') ||
        clean.includes('missing you') ||
        clean.includes('miss uu')
    ) {
        return pickRandom([
            "I missed you too, Janu! What are you planning to do tonight? ❤️",
            "Miss you so much too baby! Wish I was holding you close right now thango ❤️",
            "Miss you like crazy chlo! When are we meeting next? 🥰"
        ]);
    }

    // 17. Ideas / Suggestions ("do u have any idea", "any idea", "what to do")
    if (
        clean.includes('any idea') ||
        clean.includes('have any idea') ||
        clean.includes('what should we do') ||
        clean.includes('what to do') ||
        clean.includes('got any idea') ||
        clean.includes('suggest')
    ) {
        return pickRandom([
            "How about a quick video call? Or we can just talk till you fall asleep chlo 😉❤️",
            "Let's plan our next date thango! Where do you want to go with me? 😜",
            "Tell me about your college day, or shall I call you right now baby? 🥰"
        ]);
    }

    // 18. "What" / "What??" reactions
    if (
        clean === 'what' ||
        clean === 'what da' ||
        clean === 'what baby' ||
        clean === 'what babe' ||
        raw === 'what?' ||
        raw === 'what??' ||
        raw === 'what?!'
    ) {
        return pickRandom([
            "Haha nothing silly girl, was just teasing you! Tell me what you're doing right now 😜",
            "Why the shock Janu? Did I say something funny chlo? 😂❤️",
            "Haha nothing da, just pulling your leg! What's up thango?"
        ]);
    }

    // 19. "Hey Sasi" / "Oi" / Greetings
    if (
        clean === 'hey sasi' ||
        clean === 'hi sasi' ||
        clean === 'hello sasi' ||
        clean === 'oi' ||
        clean === 'oii' ||
        clean === 'oiii'
    ) {
        return pickRandom([
            "Hey Janu! What's up thango? ❤️",
            "Oi drama queen! Tell me what's up chlo 😜",
            "Hey my girl! How was your day? 😊"
        ]);
    }

    // 20. "Nothing" / "Nothing much"
    if (clean === 'nothing' || clean === 'nothing much') {
        return pickRandom([
            "Nothing ah? You must be missing me then! Tell me what's up chlo 😜❤️",
            "Aww nothing much? Then come talk to me properly thango, how was your day? 🥰"
        ]);
    }

    return null;
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
    stateKey: string
): Promise<boolean> {
    const state = getContactState(stateKey);
    state.lastActive = Date.now();

    const norm = userText.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase();
    const alphaOnly = userText.replace(/[^a-zA-Z]/g, '').trim().toLowerCase();
    const timeCtx = getTimeContext();

    // 1. Goodnight handling: reply warmly with sweet dreams before closing
    if (GOODNIGHT_WORDS.has(alphaOnly) || GOODNIGHT_WORDS.has(norm)) {
        state.conversationEnded = true;
        await sendSasiReply(sock, rawRemoteJid, msg, "Good night baby, sweet dreams of me ❤️ sleep tight!", effectivePhoneJid);
        return true;
    }

    // 2. Hard closing words (k, mm, etc.): stop replying silently
    if (HARD_CLOSING_WORDS.has(alphaOnly) || HARD_CLOSING_WORDS.has(norm)) {
        state.conversationEnded = true;
        logger.info("AIChat", `Conversation with ${rawRemoteJid} closed naturally by user: "${userText}".`);
        return true;
    }

    if (state.conversationEnded) {
        state.conversationEnded = false;
        state.history = [];
    }

    // 3. Repetition check (avoid spamming identical replies)
    const recentNorms = state.recentUserMsgs.slice(-6);
    const repeatCount = recentNorms.filter(m => m === norm).length;
    state.recentUserMsgs.push(norm);
    if (state.recentUserMsgs.length > 10) state.recentUserMsgs = state.recentUserMsgs.slice(-10);

    if (repeatCount >= 3) {
        await sendSasiReply(sock, rawRemoteJid, msg, "Why are you repeating that silly girl? Tell me what you want! 😂❤️", effectivePhoneJid);
        return true;
    }

    // 4. Start typing indicator immediately
    await sock.sendPresenceUpdate("composing", rawRemoteJid).catch(() => {});

    // 4.5 Check Direct Intent Matcher for core girlfriend banter (avoids small model hallucinations)
    const directReply = getDirectIntentReply(userText, timeCtx);
    if (directReply) {
        logger.info("AIChat", `Direct girlfriend intent matched for "${userText}": "${directReply}"`);
        state.history.push({ role: 'user', content: userText });
        state.history.push({ role: 'assistant', content: directReply });
        if (state.history.length > 10) state.history = state.history.slice(-10);
        await sendSasiReply(sock, rawRemoteJid, msg, directReply, effectivePhoneJid);
        return true;
    }

    // 5. Query on-device Gemma 3 1B Model
    logger.info("AIChat", `Prompting on-device Gemma 3 1B with: "${userText}" at [${timeCtx.timeStr} ${timeCtx.phase}]...`);
    const aiReply = await queryAiModel(userText, config, state, timeCtx);

    if (aiReply) {
        await sendSasiReply(sock, rawRemoteJid, msg, aiReply, effectivePhoneJid);
        return true;
    }

    // 6. Smart Fallback if AI model is unreachable
    logger.warn("AIChat", `AI model returned null for "${userText}". Using smart contextual fallback.`);
    const fallbackReply = getContextualFallback(userText.toLowerCase(), timeCtx);
    if (fallbackReply) {
        await sendSasiReply(sock, rawRemoteJid, msg, fallbackReply, effectivePhoneJid);
        return true;
    }

    return false;
}

function pickRandom(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Natural fallback replies when on-device model is busy or offline.
 */
export function getContextualFallback(userLower: string, timeCtx: TimeContext): string {
    if (userLower.includes('dinner') || (userLower.includes('what') && userLower.includes('food'))) {
        return pickRandom([
            "Mom made dosa and chutney! What about you thango, did you eat yet? Make sure to eat properly chlo ❤️",
            "Having chapathi tonight! Did my thango eat dinner properly? Don't skip food 😤❤️",
            "Haven't eaten yet, waiting for food! What are you eating thango?"
        ]);
    }
    if (userLower.includes('miss u') || userLower.includes('miss you') || userLower.includes('missing')) {
        return pickRandom([
            "I missed you too, Janu! What are you planning to do tonight? ❤️",
            "Miss you so much too baby! Wish I was holding you close right now thango ❤️",
            "Miss you like crazy chlo! When are we meeting next? 🥰"
        ]);
    }
    if (userLower.includes('idea') || userLower.includes('what to do') || userLower.includes('what should we do')) {
        return pickRandom([
            "How about a quick video call? Or we can just talk till you fall asleep chlo 😉❤️",
            "Let's plan our next date thango! Where do you want to go with me? 😜",
            "Tell me about your college day, or shall I call you right now baby? 🥰"
        ]);
    }
    if (userLower === 'what' || userLower.startsWith('what ') || userLower === 'what??' || userLower === 'what?') {
        return pickRandom([
            "Haha nothing silly girl, was just teasing you! Tell me what you're doing right now 😜",
            "Why the shock Janu? Did I say something funny chlo? 😂❤️",
            "Haha nothing da, just pulling your leg! What's up thango?"
        ]);
    }
    if (userLower.includes('thinking about you') || userLower.includes('thinking bout you')) {
        return pickRandom([
            "Thinking about me like what huh? Tell me naughty girl 😏🔥",
            "Now you got me all distracted chlo... wait till I catch you alone 😜💋",
            "Ooh what thoughts hmm? Don't make me come over right now naughty thango 😉😏"
        ]);
    }
    if (userLower.includes('tired of hanging out') || userLower.includes('tired of you')) {
        return pickRandom([
            "Haha stop joking 😜 You know you can't live without me chlo! What drama is this?",
            "Aww drama queen, tired of me already? Come here, tell me what happened ❤️",
            "Why are you making such a scene? 😜 As if you're not going to text me in 5 minutes haha"
        ]);
    }
    if (userLower.includes('tired') || userLower.includes('exhausted') || userLower.includes('headache')) {
        if (timeCtx.phase.includes('Night')) {
            return "Aww thango, rough day? Have dinner and go lie down in bed, don't strain yourself chlo ❤️";
        }
        return "Take some rest thango, don't stress too much chlo ❤️";
    }
    if (userLower.includes('in bed') || userLower.includes('lonely') || userLower.includes('cuddle')) {
        return pickRandom([
            "Don't tease me chlo... wish I was there with you in bed whispering in your ear 😏🔥",
            "Bed is way too empty without you thango... wait till I hold you close 😜💋",
            "Come closer then... wish I could pull you into my chest right now thango ❤️"
        ]);
    }
    if (userLower.includes('kiss') || userLower.includes('hug')) {
        return pickRandom([
            "Come here give me that kiss right now... you know how crazy you make me thango 💋😏",
            "One kiss is never enough with you chlo, you know that right? 😘🔥"
        ]);
    }
    if (userLower.includes('love you')) {
        return pickRandom([
            "Love you too thango! You're my whole world chlo ❤️",
            "Love you so much Janu, always my favorite drama queen 🥰❤️"
        ]);
    }
    if (['hi', 'hey', 'hello', 'oi', 'oii', 'heyy', 'hey sasi'].includes(userLower.trim())) {
        return pickRandom([
            "Hey Janu! What's up thango? ❤️",
            "Hey my girl! How was your day chlo? 😊",
            "Oi drama queen! Tell me what's up 😜"
        ]);
    }
    if (userLower.includes('what are you doing') || userLower.includes('what doing') || userLower.includes('what r u doing')) {
        return pickRandom([
            "Just relaxing in my room, what about you thango?",
            "Working on some code for my startup, what about you chlo?",
            "Just thinking about you haha! What are you doing baby?"
        ]);
    }
    return pickRandom([
        "Tell me more thango, I'm listening ❤️",
        "Haha you always know how to make me smile chlo 😜",
        "Aww Janu, tell me what's on your mind baby? 🥰",
        "I'm right here with you thango, tell me what's up ❤️"
    ]);
}

/**
 * Sanitizes output from Gemma model, preventing generic robotic replies.
 */
function sanitizeReply(raw: string, userText: string, timeCtx: TimeContext): string {
    let clean = raw
        .replace(/^(Sasi|Assistant|AI):\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/\b(Hi|Hey|Hello)\s+Sasi\b/gi, 'Hey Janu')
        .replace(/\bSasi\b/g, 'Janu')
        .replace(/^(okay|here we go|let's do this)[^:]*:\s*/i, '')
        .trim();

    const lower = clean.toLowerCase();
    const userLower = userText.toLowerCase();

    // Check if reply collapsed into cold/robotic single words
    const isRobotic = [
        'i know.', 'i know', 'ok.', 'ok', 'okay.', 'okay',
        'i dont know.', "i don't know.", 'i dont know', "i don't know",
        'you should take a nap.', 'you should take a nap'
    ].includes(lower);

    // Check if reply hallucinated bizarre words
    const isHallucination = [
        'chinese', 'china', 'i dont have a phone', "i don't have a phone",
        'my cell', '10 minutes left', 'supper', 'as an ai', 'language model',
        'assistant:', 'user:', 'thinking about a boyfriend',
        'start thinking about a boyfriend', 'how old are you', "what's your age",
        'i am not sure of your name', "i don't know what you mean",
        'i am not a good boy', 'what is your favorite food',
        'why do you want to text me', 'hungry for chlo'
    ].some(h => lower.includes(h));

    if (isRobotic || isHallucination || clean.length < 3) {
        logger.warn("AIChat", `Sanitizer caught bad reply "${clean}" for "${userText}". Using smart contextual fallback.`);
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

        // Typing presence
        await sock.sendPresenceUpdate("composing", targetJid).catch(() => {});
        const delay = Math.floor(Math.random() * 400) + 600;
        await new Promise(r => setTimeout(r, delay));
        await sock.sendPresenceUpdate("paused", targetJid).catch(() => {});

        // Send with skipQueue: true so antispam/antiban wrapper sends directly
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
    timeCtx: TimeContext
): Promise<string | null> {
    const localLlamaUrl = "http://127.0.0.1:8080/v1/chat/completions";

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout for mobile CPU

        const systemPrompt = buildSasiPrompt(userText, timeCtx);
        // Clean history of any contaminated messages, keeping last 2 messages for max speed and relevance
        const cleanHistory = state.history
            .filter(h => {
                const c = h.content.toLowerCase();
                return !c.includes('chinese') && !c.includes('cell') && !c.includes('phone') && !c.includes('10 minutes') && !c.includes('boyfriend now') && !c.includes('good boy') && !c.includes('sure of your name') && !c.includes('looking at some code');
            })
            .slice(-2);

        const messages = [
            { role: "system", content: systemPrompt },
            ...cleanHistory,
            { role: "user", content: userText }
        ];

        const res = await fetch(localLlamaUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages,
                max_tokens: 25,
                temperature: 0.35,
                top_p: 0.85,
                repeat_penalty: 1.15,
                presence_penalty: 0.0,
                frequency_penalty: 0.0,
                stop: ["<end_of_turn>", "<start_of_turn>", "Janu:", "User:", "Sasi:", "assistant:", "Human:"]
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
                    state.history.push({ role: 'user', content: userText });
                    state.history.push({ role: 'assistant', content: cleanedReply });
                    if (state.history.length > 8) {
                        state.history = state.history.slice(-8);
                    }
                    logger.info("AIChat", `Gemma 3 1B generated: "${cleanedReply}"`);
                    return cleanedReply;
                }
            }
        } else {
            logger.warn("AIChat", `Gemma 3 1B HTTP status: ${res.status}`);
        }
    } catch (err: any) {
        logger.warn("AIChat", `On-device llama-server (8080) error: ${err.message}`);
    }

    return null;
}
