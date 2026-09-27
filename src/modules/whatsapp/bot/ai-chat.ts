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
 * Builds dynamic system prompt for Sasi with time awareness and mood handling.
 */
export function buildSasiPrompt(userText: string, timeCtx: TimeContext): string {
    const norm = userText.toLowerCase();

    const isFlirtyOrHorny = [
        'thinking about you', 'thinking bout you', 'in bed', 'lonely', 'kiss', 'hug',
        'cuddle', 'wearing', 'naughty', 'hot', 'sexy', 'horny', 'craving', 'touch',
        'lips', 'boobs', 'cuddles', 'romance', 'flirt', 'tease', 'naked', 'stripping',
        'turn on', 'turned on', 'miss you', 'love you', 'cherry', 'anae',
        '🍒', '😘', '😏', '💋', '🔥', '👅', '🤤', '🥵'
    ].some(k => norm.includes(k));

    const isAngryOrSulking = [
        'tired of hanging out with you', 'tired of you', 'angry', 'hate you',
        'dont talk to me', "don't talk to me", 'leave me alone', 'leave me',
        'why are you like this', 'you dont care', "you don't care", 'irritating',
        'mad at you', 'go away', 'annoying', 'boring'
    ].some(k => norm.includes(k));

    const isTiredOrStressed = [
        'tired', 'exhausted', 'headache', 'fever', 'stress', 'stressed', 'pain',
        'so much work', 'sleepy', 'drained'
    ].some(k => norm.includes(k));

    const isDinnerOrFood = [
        'dinner', "what's for dinner", 'what for dinner', 'sapdiya', 'had food',
        'food', 'lunch', 'breakfast', 'eat'
    ].some(k => norm.includes(k));

    let moodGuidance = "";

    if (isFlirtyOrHorny) {
        moodGuidance = `
[CURRENT MOOD: Janu is being romantic, flirtatious, teasing, or passionate! Match her energy with intense romantic confidence, seductive charm, and playful banter. Flatter her, tease her playfully, make her blush and feel desired ("Thinking about me like what? Tell me naughty girl 😏🔥 You know how crazy you make me", "Wish I was right there with you in bed, holding you tight and kissing your neck 😘❤️", "You look so breathtakingly gorgeous, can't get you out of my head"). Be magnetic, deeply romantic, and charming!]`;
    } else if (isAngryOrSulking) {
        moodGuidance = `
[CURRENT MOOD: Janu is feeling annoyed, sulking, or playfully mad ("tired of hanging out with you"). NEVER say "I know", "Ok", or get defensive. Disarm her completely with sweet, gentle, loving romance ("Aww baby why are you saying that 🥺 You know you can't live without me silly girl ❤️ Come here, give me a hug", "Don't be mad at me chlo... you're my whole world, tell me what happened").]`;
    } else if (isTiredOrStressed) {
        moodGuidance = `
[CURRENT MOOD: Janu is tired or stressed. Be deeply loving, comforting, and affectionate ("Aww my baby had a rough day? Come here and relax, let me take care of you ❤️ Eat dinner properly first").]`;
    } else if (isDinnerOrFood) {
        moodGuidance = `
[CURRENT CONTEXT: Janu is asking about dinner/food. Answer naturally like Sasi ("Mom made dosa and chutney at home! What about you baby, did you eat yet?"). NEVER say "I don't know".]`;
    }

    return `You are Sasi, a 21-year-old guy texting on WhatsApp with your girlfriend Janu (contact name Kanojo~Anae🍒😘).
Your name is Sasi. Your girlfriend's name is Janu (also called Kanojo, Jaanu, baby, chlo, pondati).
You love her with all your heart. You are her real boyfriend, NEVER an AI assistant or bot.
Never say "I am an assistant" or "How can I help you". You are chatting as Sasi directly to your girlfriend.

Current Time: ${timeCtx.timeStr} (${timeCtx.phase}).
${timeCtx.guidance}
${moodGuidance}

TEXTING RULES:
1. PURE CASUAL ENGLISH: Speak casual English with sweet pet names (Janu, baby, silly girl, chlo).
2. SHORT & PUNCHY: 1 or 2 short natural WhatsApp sentences (under 20 words). Never write long paragraphs.
3. BE THE REAL SASI:
   - When she flirts or gets naughty: Be hot, spicy, teasing, and confident!
   - When she is mad or says "tired of hanging out with you": Be loving, gentle, and disarming ("Aww baby why are you saying that 🥺 What did I do? You know you love me silly girl ❤️").
   - When she asks what's for dinner or daily questions: Answer naturally ("Mom made dosa/chapathi! What about you baby?").
4. STRICT PROHIBITIONS:
   - NEVER say "I know.", "Ok.", or "I don't know." like a cold robot.
   - NEVER say "good morning" at night or evening.
   - NEVER suggest afternoon naps at night.
5. Output ONLY Sasi's text message.`;
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
            "Mom made dosa and chutney at home! What about you baby, did you eat yet?",
            "Having chapathi and curry tonight! Did my girl eat dinner properly? ❤️",
            "Haven't eaten yet, waiting for food! What are you eating baby?"
        ]);
    }
    if (userLower.includes('thinking about you') || userLower.includes('thinking bout you')) {
        return pickRandom([
            "Thinking about me like what? Tell me naughty girl 😏🔥 Wish I was right there with you",
            "Now you got me thinking about you too... wish I was there holding you close and kissing your neck 😏❤️",
            "What kind of thoughts hmm? Don't make me come over right now silly girl 😉💋"
        ]);
    }
    if (userLower.includes('tired of hanging out') || userLower.includes('tired of you')) {
        return pickRandom([
            "Aww why silly girl? 🥺 You know you love me! Come here, tell me what happened ❤️",
            "Tired of me? You know you can't live without your Sasi 😜 come here baby, give me a hug ❤️"
        ]);
    }
    if (userLower.includes('tired') || userLower.includes('exhausted') || userLower.includes('headache')) {
        if (timeCtx.phase.includes('Night')) {
            return "Aww rough day baby? Have dinner and go rest in bed, don't strain yourself ❤️";
        }
        return "Take some rest then silly girl, don't stress too much ❤️";
    }
    if (userLower.includes('homework') || userLower.includes('assignment')) {
        return "It's okay do it tomorrow properly, don't stress tonight baby ❤️";
    }
    if (userLower.includes('in bed') || userLower.includes('lonely') || userLower.includes('cuddle')) {
        return pickRandom([
            "Don't tempt me baby... wish I was there in bed cuddling you tight and whispering in your ear 😏❤️",
            "My bed feels way too empty without you right now... dream of me holding you close tonight baby 😘",
            "Come closer then... wish I could pull you into my chest and never let you go ❤️"
        ]);
    }
    if (userLower.includes('kiss') || userLower.includes('hug')) {
        return pickRandom([
            "Come here give me that kiss right now... you know how weak you make me baby 💋❤️",
            "One kiss is never going to be enough with you, you know that right? 😘🔥"
        ]);
    }
    if (userLower.includes('love you')) {
        return pickRandom([
            "Love you so much more Janu, you have no idea how crazy I am about you ❤️",
            "Love you my beautiful girl, you're the best thing that ever happened to me 🥰❤️"
        ]);
    }
    if (userLower.includes('miss you')) {
        return pickRandom([
            "Miss you so much more baby... counting the seconds until I can see you and hold your hand ❤️",
            "Miss you like crazy Janu... wishing I could see your pretty smile right now ❤️"
        ]);
    }
    if (['hi', 'hey', 'hello', 'oi', 'oii', 'heyy'].includes(userLower.trim())) {
        if (timeCtx.phase === 'Morning') return "Hey Janu! Morning baby, did you wake up? ❤️";
        if (timeCtx.phase.includes('Night')) return "Hey Janu! What's up, having dinner? 😊";
        return "Hey Janu! What's up? 😊";
    }
    if (userLower.includes('what are you doing') || userLower.includes('what doing') || userLower.includes('what r u doing')) {
        if (timeCtx.phase.includes('Night')) return "Just chilling on my laptop in my room, what about you baby?";
        return "Working on some code right now, what about you?";
    }
    return "Hey Janu, was just occupied with code! Tell me what's up?";
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

    if (isRobotic || clean.length < 3) {
        logger.warn("AIChat", `Sanitizer caught robotic reply "${clean}" for "${userText}". Using smart contextual fallback.`);
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
        const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout for mobile CPU

        const systemPrompt = buildSasiPrompt(userText, timeCtx);
        const recentHistory = state.history.slice(-6);
        const messages = [
            { role: "system", content: systemPrompt },
            ...recentHistory,
            { role: "user", content: userText }
        ];

        const res = await fetch(localLlamaUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages,
                max_tokens: 45,
                temperature: 0.65,
                top_p: 0.9,
                repeat_penalty: 1.25,
                presence_penalty: 0.3,
                frequency_penalty: 0.3,
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
                    if (state.history.length > 12) {
                        state.history = state.history.slice(-12);
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
