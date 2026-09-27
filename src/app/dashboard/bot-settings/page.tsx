"use client";

import { useState, useEffect } from "react";
import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Save, AlertCircle, Bot, X, Plus, ShieldCheck, Zap, UserCheck, MessageSquarePlus, Heart, MessageCircle, Cpu } from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";

export default function BotSettingsPage() {
    const { sessionId } = useSessionProvider();

    const [botConfig, setBotConfig] = useState({
        enabled: true,
        botName: "WA-AKG Bot",
        prefix: "#",
        enableSticker: true,
        enableVideoSticker: true,
        maxStickerDuration: 10,
        enablePing: true,
        enableUptime: true,
        enableAi: false,
        aiApiKey: "",
        aiProvider: "local",
        removeBgApiKey: "",
        botMode: "OWNER",
        autoReplyMode: "ALL",
        antiSpamEnabled: false,
        spamLimit: 5,
        spamInterval: 10,
        spamDelayMin: 1000,
        spamDelayMax: 3000,

        // New fields
        welcomeMessage: "",
        autoRead: false,
        alwaysOnline: false,
        botAllowedJids: [] as string[],
        botBlockedJids: [] as string[],
        autoReplyAllowedJids: [] as string[],
        autoReplyBlockedJids: [] as string[],

        // Anti-Link
        antiLinkMode: "OFF" as "OFF" | "INVITE" | "ALL",
        antiLinkAction: "DELETE" as "DELETE" | "KICK",
        antiLinkLimit: 3,
        antiLinkScope: "ALL" as "ALL" | "SPECIFIC",
        antiLinkGroups: [] as string[],

        // AI Contact Persona Chat
        enableAiChat: false,
        aiChatAllowedJids: [] as string[],
        aiChatEndpoint: "http://127.0.0.1:8080/v1/chat/completions",
        aiChatProvider: "local",
    });
    const [botLoading, setBotLoading] = useState(false);

    const [newJid, setNewJid] = useState("");
    const [newAiJid, setNewAiJid] = useState("");
    const [contactsList, setContactsList] = useState<Array<{ jid: string; name: string }>>([]);

    const [privacyConfig, setPrivacyConfig] = useState({
        ghostMode: false,
        antiDelete: false,
        readReceipts: true,
    });
    const [privacyLoading, setPrivacyLoading] = useState(false);
    const [groupsList, setGroupsList] = useState<Array<{ jid: string; subject: string | null }>>([]);
    const [groupSearch, setGroupSearch] = useState("");
    const [groupsRefreshing, setGroupsRefreshing] = useState(false);

    const fetchGroupsList = async (forceRefresh = false) => {
        if (!sessionId) return;
        try {
            if (forceRefresh) setGroupsRefreshing(true);
            const url = `/api/groups/${sessionId}${forceRefresh ? "?refresh=1" : ""}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.status) {
                setGroupsList(
                    (data.data || []).map((g: any) => ({ jid: g.jid, subject: g.subject || null }))
                );
            }
            if (forceRefresh) toast.success("Group list refreshed");
        } catch {
            if (forceRefresh) toast.error("Failed to refresh groups");
        } finally {
            if (forceRefresh) setGroupsRefreshing(false);
        }
    };

    useEffect(() => {
        if (!sessionId) return;
        fetchGroupsList();

        fetch(`/api/contacts/${sessionId}?limit=all`)
            .then(res => res.json())
            .then(responseData => {
                const list = responseData?.data?.contacts || responseData?.contacts || [];
                if (Array.isArray(list)) {
                    setContactsList(list.map((c: any) => ({
                        jid: c.jid,
                        name: c.name || c.notify || c.verifiedName || c.jid
                    })));
                }
            })
            .catch(() => { });

        fetch(`/api/sessions/${sessionId}/bot-config`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setBotConfig(prev => ({
                        ...prev,
                        ...data,
                        enabled: data.enabled ?? prev.enabled,
                        botName: data.botName || prev.botName,
                        botMode: data.botMode || prev.botMode,
                        autoReplyMode: data.autoReplyMode || prev.autoReplyMode,
                        enableAi: data.enableAi === true,
                        aiApiKey: data.aiApiKey || "",
                        aiProvider: data.aiProvider || "local",
                        removeBgApiKey: data.removeBgApiKey || "",
                        prefix: data.prefix || "#",
                        welcomeMessage: data.welcomeMessage || "",
                        botAllowedJids: Array.isArray(data.botAllowedJids) ? data.botAllowedJids : [],
                        botBlockedJids: Array.isArray(data.botBlockedJids) ? data.botBlockedJids : [],
                        autoReplyAllowedJids: Array.isArray(data.autoReplyAllowedJids) ? data.autoReplyAllowedJids : [],
                        autoReplyBlockedJids: Array.isArray(data.autoReplyBlockedJids) ? data.autoReplyBlockedJids : [],
                        antiLinkMode: data.antiLinkMode || "OFF",
                        antiLinkAction: data.antiLinkAction || "DELETE",
                        antiLinkScope: data.antiLinkScope || "ALL",
                        antiLinkLimit: typeof data.antiLinkLimit === 'number' ? data.antiLinkLimit : 3,
                        antiLinkGroups: Array.isArray(data.antiLinkGroups) ? data.antiLinkGroups : [],
                        enableAiChat: data.enableAiChat === true,
                        aiChatAllowedJids: Array.isArray(data.aiChatAllowedJids) ? data.aiChatAllowedJids : [],
                        aiChatEndpoint: data.aiChatEndpoint || "http://127.0.0.1:8080/v1/chat/completions",
                        aiChatProvider: data.aiChatProvider || "local",
                        spamLimit: typeof data.spamLimit === 'number' ? data.spamLimit : 5,
                        spamInterval: typeof data.spamInterval === 'number' ? data.spamInterval : 10,
                        spamDelayMin: typeof data.spamDelayMin === 'number' ? data.spamDelayMin : 1000,
                        spamDelayMax: typeof data.spamDelayMax === 'number' ? data.spamDelayMax : 3000,
                        maxStickerDuration: typeof data.maxStickerDuration === 'number' ? data.maxStickerDuration : 10,
                    }));
                }
            })
            .catch(() => { });

        fetch(`/api/sessions/${sessionId}/settings`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setPrivacyConfig({
                        ghostMode: data.config?.ghostMode || false,
                        antiDelete: data.config?.antiDelete || false,
                        readReceipts: data.config?.readReceipts ?? true
                    });
                }
            })
            .catch(() => { });
    }, [sessionId]);

    const handleSaveBot = async () => {
        if (!sessionId) return;
        setBotLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(botConfig)
            });

            if (res.ok) {
                toast.success("Bot configuration saved");
            } else {
                toast.error("Failed to save bot configuration");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error saving bot configuration");
        } finally {
            setBotLoading(false);
        }
    };

    const handleSavePrivacy = async () => {
        if (!sessionId) return;
        setPrivacyLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    config: {
                        ghostMode: privacyConfig.ghostMode,
                        antiDelete: privacyConfig.antiDelete,
                        readReceipts: privacyConfig.readReceipts
                    }
                })
            });

            if (res.ok) {
                toast.success("Privacy settings saved");
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.message || "Failed to save privacy settings");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error saving privacy settings");
        } finally {
            setPrivacyLoading(false);
        }
    };

    const addJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids') => {
        if (!newJid || !newJid.trim()) return;
        let formatted = newJid.trim();
        if (!formatted.includes('@')) formatted += '@s.whatsapp.net';

        const list = Array.isArray(botConfig[listName]) ? botConfig[listName] : [];
        if (!list.includes(formatted)) {
            setBotConfig(prev => ({
                ...prev,
                [listName]: [...(Array.isArray(prev[listName]) ? prev[listName] : []), formatted]
            }));
        }
        setNewJid("");
    };

    const removeJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids', jid: string) => {
        setBotConfig(prev => ({
            ...prev,
            [listName]: (Array.isArray(prev[listName]) ? prev[listName] : []).filter(item => item !== jid)
        }));
    };

    const addAiJid = (jidToAdd?: string) => {
        const val = jidToAdd || newAiJid;
        if (!val || !val.trim()) return;
        let formatted = val.trim();
        if (!formatted.includes('@')) formatted += '@s.whatsapp.net';

        const list = Array.isArray(botConfig.aiChatAllowedJids) ? botConfig.aiChatAllowedJids : [];
        if (!list.includes(formatted)) {
            setBotConfig(prev => ({
                ...prev,
                aiChatAllowedJids: [...(Array.isArray(prev.aiChatAllowedJids) ? prev.aiChatAllowedJids : []), formatted]
            }));
        }
        if (!jidToAdd) setNewAiJid("");
    };

    const removeAiJid = (jid: string) => {
        setBotConfig(prev => ({
            ...prev,
            aiChatAllowedJids: (Array.isArray(prev.aiChatAllowedJids) ? prev.aiChatAllowedJids : []).filter(item => item !== jid)
        }));
    };

    const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Bot Settings</h2>
                    <p className="text-muted-foreground text-sm mt-1">Configure bot features and session privacy for the active WhatsApp session.</p>
                </div>

                {/* Bot Mode & Access Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-primary" />
                            Bot Mode & Access Control
                        </CardTitle>
                        <CardDescription>Configure who can interact with the bot and use commands.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                            {/* Master toggle — when off, ALL bot features (commands, auto-reply) are paused */}
                            <div className="flex items-center justify-between gap-4 rounded-lg border p-3 bg-muted/20">
                                <div className="space-y-0.5">
                                    <Label htmlFor="bot-enabled" className="text-sm font-semibold cursor-pointer">
                                        Bot Enabled
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Master switch — when off, the bot ignores all commands and auto-replies for this session.
                                    </p>
                                </div>
                                <Switch
                                    id="bot-enabled"
                                    checked={botConfig.enabled}
                                    onCheckedChange={c => setBotConfig(prev => ({ ...prev, enabled: c }))}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label>Bot Name</Label>
                                <Input
                                    placeholder="WA-AKG Bot"
                                    value={botConfig.botName || ""}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, botName: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">The display name used by the bot in automated responses.</p>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Command Prefix</Label>
                                    <Input
                                        className="max-w-[100px]"
                                        placeholder="#"
                                        maxLength={3}
                                        value={botConfig.prefix || "#"}
                                        onChange={(e) => setBotConfig(prev => ({ ...prev, prefix: e.target.value }))}
                                    />
                                    <p className="text-xs text-muted-foreground">The prefix character for bot commands.</p>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Bot Interaction Mode</Label>
                                    <Select
                                        value={botConfig.botMode || "OWNER"}
                                        onValueChange={(v: any) => setBotConfig(prev => ({ ...prev, botMode: v }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Mode" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">Public (Everyone)</SelectItem>
                                            <SelectItem value="OWNER">Private (Owner Only)</SelectItem>
                                            <SelectItem value="SPECIFIC">Whitelist (Selected JIDs)</SelectItem>
                                            <SelectItem value="BLACKLIST">Blacklist (Block JIDs)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Control who can trigger bot commands.</p>
                                </div>
                            </div>

                            {(botConfig.botMode === 'SPECIFIC' || botConfig.botMode === 'BLACKLIST') && (
                                <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <Label className="flex items-center gap-2">
                                        <UserCheck className="h-4 w-4" />
                                        {botConfig.botMode === 'SPECIFIC' ? "Whitelisted Numbers" : "Blacklisted Numbers"}
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="628123456789@s.whatsapp.net"
                                            value={newJid}
                                            onChange={(e) => setNewJid(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}
                                        />
                                        <Button variant="outline" size="icon" onClick={() => addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {(botConfig.botMode === 'SPECIFIC' ? (botConfig.botAllowedJids || []) : (botConfig.botBlockedJids || [])).map(jid => (
                                            <div key={jid} className="flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs font-medium">
                                                {jid}
                                                <button onClick={() => removeJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids', jid)} className="text-muted-foreground hover:text-destructive transition-colors">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {(botConfig.botMode === 'SPECIFIC' ? (botConfig.botAllowedJids || []) : (botConfig.botBlockedJids || [])).length === 0 && (
                                            <p className="text-xs text-muted-foreground italic">No numbers added yet.</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-ping" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Ping Command</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Respond to {botConfig.prefix}ping</span>
                                    </Label>
                                    <Switch id="enable-ping" checked={botConfig.enablePing}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enablePing: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-uptime" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Uptime Command</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Respond to {botConfig.prefix}uptime</span>
                                    </Label>
                                    <Switch id="enable-uptime" checked={botConfig.enableUptime}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableUptime: c }))} />
                                </div>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Bot Configuration
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Automation & Presence Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Zap className="h-5 w-5 text-yellow-500" />
                                Automation & Presence
                            </CardTitle>
                            <CardDescription>Advanced bot automation and presence customization.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="always-online" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Always Online</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Stay "Online" even when inactive.</span>
                                    </Label>
                                    <Switch id="always-online" checked={botConfig.alwaysOnline}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, alwaysOnline: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="auto-read" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Auto Read (Blue Ticks)</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Automatically mark messages as read.</span>
                                    </Label>
                                    <Switch id="auto-read" checked={botConfig.autoRead}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, autoRead: c }))} />
                                </div>
                            </div>

                            <div className="space-y-2 border-t border-border/50 pt-4">
                                <Label className="flex items-center gap-2">
                                    <MessageSquarePlus className="h-4 w-4 text-primary" />
                                    Welcome Message (Beta)
                                </Label>
                                <Textarea
                                    placeholder="Hello! Welcome to our WhatsApp Bot. How can I help you today?"
                                    className="min-h-[100px]"
                                    value={botConfig.welcomeMessage}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                                />
                                <p className="text-[10px] text-muted-foreground">Sent automatically to users when they message this bot for the first time.</p>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Automation Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Media & Stickers Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Media & Stickers</CardTitle>
                            <CardDescription>Configure how the bot handles media and sticker conversion.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-sticker" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Image to Sticker</span>
                                        <span className="font-normal text-xs text-muted-foreground">Auto-convert images</span>
                                    </Label>
                                    <Switch id="enable-sticker" checked={botConfig.enableSticker}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableSticker: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-video-sticker" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Video to Sticker</span>
                                        <span className="font-normal text-xs text-muted-foreground">Auto-convert short videos</span>
                                    </Label>
                                    <Switch id="enable-video-sticker" checked={botConfig.enableVideoSticker}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableVideoSticker: c }))} />
                                </div>
                            </div>

                            <div className="grid gap-2 border-t border-border/50 pt-4">
                                <Label>Max Sticker Video Duration: <strong>{botConfig.maxStickerDuration}s</strong></Label>
                                <Slider
                                    value={[botConfig.maxStickerDuration || 10]}
                                    onValueChange={([v]) => setBotConfig(prev => ({ ...prev, maxStickerDuration: v }))}
                                    min={3}
                                    max={30}
                                    step={1}
                                />
                                <p className="text-xs text-muted-foreground">Maximum video duration (in seconds) allowed for sticker conversion.</p>
                            </div>

                            <div className="grid gap-2 border-t border-border/50 pt-4">
                                <Label>Remove.bg API Key (Optional)</Label>
                                <Input
                                    type="password"
                                    placeholder="Enter your Remove.bg API Key"
                                    value={botConfig.removeBgApiKey || ""}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, removeBgApiKey: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">Enables background removal for stickers (use <code className="bg-muted px-1 rounded">nobg</code> caption).</p>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Media Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Sasi AI Contact Auto-Chat */}
                    <Card className="border-pink-500/20 bg-gradient-to-br from-card via-card to-pink-500/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Heart className="h-5 w-5 text-pink-500 fill-pink-500/20" />
                                AI Contact Auto-Chat (Sasi AI Persona)
                            </CardTitle>
                            <CardDescription>
                                Automatically chat with selected contacts using Sasi's natural, casual English personality. Responds 100% like a real human without bot prefixes, simulates natural typing pauses, and stops talking silently on closing remarks (ok, mm, bye).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-pink-500/5 border-pink-500/20">
                                <Label htmlFor="enable-ai-chat" className="flex flex-col space-y-1 cursor-pointer">
                                    <span className="font-medium text-pink-600 dark:text-pink-400">Enable AI Auto-Chat for Selected Contacts</span>
                                    <span className="font-normal text-xs text-muted-foreground">
                                        Only messages from contacts added to the Allowed Contacts list below will be answered by the AI model.
                                    </span>
                                </Label>
                                <Switch
                                    id="enable-ai-chat"
                                    checked={botConfig.enableAiChat}
                                    onCheckedChange={(c) => setBotConfig((prev) => ({ ...prev, enableAiChat: c }))}
                                />
                            </div>

                            {botConfig.enableAiChat && (
                                <div className="space-y-5 pt-2 border-t border-border/50 animate-in fade-in duration-200">
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="flex items-center gap-1.5">
                                                <span>AI Engine</span>
                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-emerald-600 bg-emerald-500/10 border border-emerald-500/30">Edge Device Only</span>
                                            </Label>
                                            <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs space-y-1">
                                                <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                                    <Cpu className="h-4 w-4" /> On-Device Native Gemma-3 1B
                                                </div>
                                                <p className="text-muted-foreground">
                                                    Runs 100% directly on your mobile device via embedded llama-server (port 8080). Completely offline, private, and self-contained — no PC server or cloud fallback needed!
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid gap-2">
                                            <Label>Edge llama-server Endpoint</Label>
                                            <Input
                                                placeholder="http://127.0.0.1:8080/v1/chat/completions"
                                                value={botConfig.aiChatEndpoint || "http://127.0.0.1:8080/v1/chat/completions"}
                                                onChange={(e) => setBotConfig((prev) => ({ ...prev, aiChatEndpoint: e.target.value }))}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Local mobile endpoint: <code>http://127.0.0.1:8080/v1/chat/completions</code>.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Selected Contacts Section */}
                                    <div className="space-y-3 pt-2 border-t border-border/50">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="font-semibold text-sm">Allowed Contacts for AI Chat</Label>
                                                <p className="text-xs text-muted-foreground">
                                                    Only these specific WhatsApp chats will be answered by Sasi's AI model.
                                                </p>
                                            </div>
                                            {!(botConfig.aiChatAllowedJids || []).includes("919629213731@s.whatsapp.net") && (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="text-xs h-7 gap-1 bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-300 border border-pink-500/30"
                                                    onClick={() => addAiJid("919629213731@s.whatsapp.net")}
                                                >
                                                    <Plus className="h-3 w-3" /> Quick Add Janu (Kanojo)
                                                </Button>
                                            )}
                                        </div>

                                        {/* Contact selection & custom input */}
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            {contactsList.length > 0 && (
                                                <div className="w-full sm:w-1/2">
                                                    <Select onValueChange={(val) => { if (val) addAiJid(val); }}>
                                                        <SelectTrigger className="text-xs">
                                                            <SelectValue placeholder="Select from contacts..." />
                                                        </SelectTrigger>
                                                        <SelectContent className="max-h-56">
                                                            {contactsList.map(c => (
                                                                <SelectItem key={c.jid} value={c.jid} className="text-xs">
                                                                    {c.name} ({c.jid.split('@')[0]})
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                            <div className="flex gap-2 flex-1">
                                                <Input
                                                    placeholder="Enter phone number or JID (e.g. 919629213731)"
                                                    value={newAiJid}
                                                    onChange={(e) => setNewAiJid(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && addAiJid()}
                                                    className="text-xs"
                                                />
                                                <Button variant="outline" size="sm" onClick={() => addAiJid()}>
                                                    <Plus className="h-4 w-4 mr-1" /> Add
                                                </Button>
                                            </div>
                                        </div>

                                        {/* List of active contacts */}
                                        <div className="flex flex-wrap gap-2 pt-2">
                                            {(botConfig.aiChatAllowedJids || []).map(jid => {
                                                const contact = contactsList.find(c => c.jid === jid || c.jid.split('@')[0] === jid.split('@')[0]);
                                                const label = contact?.name ? `${contact.name} (${jid.split('@')[0]})` : jid;
                                                return (
                                                    <span
                                                        key={jid}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-pink-500/10 text-pink-700 dark:text-pink-300 border border-pink-500/30"
                                                    >
                                                        <Heart className="h-3 w-3 fill-pink-500 text-pink-500" />
                                                        {label}
                                                        <button
                                                            onClick={() => removeAiJid(jid)}
                                                            className="ml-1 hover:text-destructive transition-colors"
                                                            title="Remove contact"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    </span>
                                                );
                                            })}
                                            {(botConfig.aiChatAllowedJids || []).length === 0 && (
                                                <p className="text-xs text-muted-foreground italic">
                                                    No contacts added yet. Add a contact above to enable AI auto-chat.
                                                </p>
                                            )}
                                        </div>

                                        {/* Behaviour Rules Highlight */}
                                        <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-3 text-xs space-y-1.5">
                                            <p className="font-semibold text-pink-700 dark:text-pink-300">✨ Sasi Personality Active Safeguards:</p>
                                            <p className="text-muted-foreground">• <strong>Pure English:</strong> Talks naturally in casual English without any Tamil words.</p>
                                            <p className="text-muted-foreground">• <strong>Human Tone:</strong> Short, punchy messages (1-2 lines), no bot prefixes (like # or [AI]), natural typing delays.</p>
                                            <p className="text-muted-foreground">• <strong>Silent Ending:</strong> Gracefully goes silent when the other person sends "ok", "mm", "bye", "good night", etc.</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2">
                                <Button
                                    className="w-full sm:w-auto bg-pink-600 hover:bg-pink-700 text-white"
                                    onClick={handleSaveBot}
                                    disabled={botLoading || !sessionId}
                                >
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save AI Contact Chat Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Anti-Ban Protection */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-orange-500" />
                                Anti-Ban Protection (Beta)
                            </CardTitle>
                            <CardDescription>
                                Prevent your WhatsApp number from being detected as spam or banned by adding intelligent random delays between outgoing messages. This applies to <strong>all</strong> actions: bot replies, auto-replies, broadcasts, scheduled messages, and API calls for this session.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-orange-500/5 border-orange-500/20">
                                <Label htmlFor="anti-spam" className="flex flex-col space-y-1">
                                    <span className="font-semibold text-orange-700 dark:text-orange-400">Enable Anti-Spam Delay</span>
                                    <span className="font-normal text-xs text-muted-foreground">When enabled, messages will be queued and sent with a random delay if the rate limit is reached. Messages are never rejected — only delayed.</span>
                                </Label>
                                <Switch id="anti-spam" checked={botConfig.antiSpamEnabled}
                                    onCheckedChange={c => setBotConfig(prev => ({ ...prev, antiSpamEnabled: c }))} />
                            </div>

                            {botConfig.antiSpamEnabled && (
                                <div className="grid gap-6 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {/* How it works */}
                                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
                                        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">💡 How it works</p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            The system tracks how many messages this session sends within a time window.
                                            If the number of messages exceeds the <strong>threshold</strong> within the <strong>time window</strong>,
                                            each subsequent message will be <strong>delayed</strong> by a random amount between <strong>Min</strong> and <strong>Max</strong> delay.
                                            Once the time window resets (old messages expire), messages go back to normal speed.
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            <strong>Example:</strong> With threshold = <strong>{botConfig.spamLimit ?? 5}</strong> and window = <strong>{botConfig.spamInterval ?? 10}s</strong> →
                                            the first {botConfig.spamLimit ?? 5} messages within {botConfig.spamInterval ?? 10} seconds are sent instantly.
                                            Message #{(botConfig.spamLimit ?? 5) + 1} and beyond will be delayed by {botConfig.spamDelayMin ?? 1000}ms–{botConfig.spamDelayMax ?? 3000}ms each.
                                        </p>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Messages Threshold</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamLimit ?? 5}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamLimit: parseInt(e.target.value) || 1 }))}
                                                min={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Number of messages allowed at full speed before delay kicks in.
                                                <span className="text-orange-600 dark:text-orange-400"> Lower = safer but slower.</span>
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Time Window (Seconds)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamInterval ?? 10}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamInterval: parseInt(e.target.value) || 1 }))}
                                                min={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                The rolling window to count messages. After this time passes, the counter resets naturally.
                                                <span className="text-orange-600 dark:text-orange-400"> Longer = more conservative.</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Min Delay (ms)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamDelayMin ?? 1000}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamDelayMin: parseInt(e.target.value) || 0 }))}
                                                min={0}
                                                step={100}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Minimum random delay applied. 1000ms = 1 second.
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Max Delay (ms)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamDelayMax ?? 3000}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamDelayMax: parseInt(e.target.value) || 0 }))}
                                                min={0}
                                                step={100}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Maximum random delay applied. 3000ms = 3 seconds.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                                        <p className="text-xs text-muted-foreground">
                                            ⚠️ <strong>Recommended safe settings:</strong> Threshold <strong>5</strong>, Window <strong>10s</strong>, Delay <strong>1000–3000ms</strong>.
                                            For high-volume broadcasts, use Threshold <strong>3</strong> with Delay <strong>2000–5000ms</strong>.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2">
                                <Button onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Protection Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Anti-Link (Group) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Anti-Link (Group)</CardTitle>
                            <CardDescription>
                                Auto-delete messages containing links in groups. Bot must be group admin to enforce.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Mode</Label>
                                    <Select
                                        value={botConfig.antiLinkMode}
                                        onValueChange={(v) =>
                                            setBotConfig((p) => ({ ...p, antiLinkMode: v as any }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="OFF">Off</SelectItem>
                                            <SelectItem value="INVITE">Block WA invite links only</SelectItem>
                                            <SelectItem value="ALL">Block ALL links</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        <code>INVITE</code> blocks <code>chat.whatsapp.com/...</code>. <code>ALL</code> blocks any URL.
                                    </p>
                                </div>

                                <div className="grid gap-2">
                                    <Label>Action</Label>
                                    <Select
                                        value={botConfig.antiLinkAction}
                                        onValueChange={(v) =>
                                            setBotConfig((p) => ({ ...p, antiLinkAction: v as any }))
                                        }
                                        disabled={botConfig.antiLinkMode === "OFF"}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="DELETE">Delete + Warn</SelectItem>
                                            <SelectItem value="KICK">Warn then Kick after limit</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {botConfig.antiLinkAction === "KICK" && botConfig.antiLinkMode !== "OFF" && (
                                <div className="grid gap-2 max-w-[200px]">
                                    <Label>Warn Limit</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={botConfig.antiLinkLimit ?? 3}
                                        onChange={(e) =>
                                            setBotConfig((p) => ({
                                                ...p,
                                                antiLinkLimit: Math.max(1, Math.min(10, Number(e.target.value) || 3)),
                                            }))
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Kick after this many warnings.
                                    </p>
                                </div>
                            )}

                            {/* Scope: ALL groups vs SPECIFIC */}
                            {botConfig.antiLinkMode !== "OFF" && (
                                <div className="grid gap-2">
                                    <Label>Apply To</Label>
                                    <Select
                                        value={botConfig.antiLinkScope}
                                        onValueChange={(v) =>
                                            setBotConfig((p) => ({ ...p, antiLinkScope: v as any }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All groups</SelectItem>
                                            <SelectItem value="SPECIFIC">Selected groups only</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Group picker — only when scope=SPECIFIC */}
                            {botConfig.antiLinkMode !== "OFF" && botConfig.antiLinkScope === "SPECIFIC" && (
                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <Label>Active Groups ({(botConfig.antiLinkGroups || []).length} selected)</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fetchGroupsList(true)}
                                            disabled={groupsRefreshing}
                                        >
                                            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${groupsRefreshing ? "animate-spin" : ""}`} />
                                            Refresh
                                        </Button>
                                    </div>
                                    <Input
                                        placeholder="Search groups..."
                                        value={groupSearch}
                                        onChange={(e) => setGroupSearch(e.target.value)}
                                    />
                                    <div className="max-h-56 overflow-y-auto border rounded-lg p-2 space-y-1 bg-muted/20">
                                        {groupsList.length === 0 ? (
                                            <p className="text-xs text-muted-foreground text-center py-3">
                                                No groups found. Click Refresh to sync from WhatsApp.
                                            </p>
                                        ) : (
                                            groupsList
                                                .filter((g) =>
                                                    !groupSearch ||
                                                    (g.subject || g.jid).toLowerCase().includes(groupSearch.toLowerCase())
                                                )
                                                .map((g) => {
                                                    const checked = (botConfig.antiLinkGroups || []).includes(g.jid);
                                                    return (
                                                        <label
                                                            key={g.jid}
                                                            className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm hover:bg-muted ${checked ? "bg-primary/10 border border-primary/30" : ""}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={(e) => {
                                                                    setBotConfig((p) => ({
                                                                        ...p,
                                                                        antiLinkGroups: e.target.checked
                                                                            ? [...(Array.isArray(p.antiLinkGroups) ? p.antiLinkGroups : []), g.jid]
                                                                            : (Array.isArray(p.antiLinkGroups) ? p.antiLinkGroups : []).filter((x) => x !== g.jid),
                                                                    }));
                                                                }}
                                                                className="shrink-0"
                                                            />
                                                            <span className="truncate">{g.subject || g.jid}</span>
                                                        </label>
                                                    );
                                                })
                                        )}
                                    </div>
                                </div>
                            )}

                            <p className="text-xs text-muted-foreground border-l-2 border-amber-500/50 pl-3 py-1 bg-amber-500/5 rounded">
                                ℹ️ Group admins are exempt. Bot must be admin to delete or kick.
                            </p>

                            <div className="pt-2">
                                <Button onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Anti-Link Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Privacy & Utility */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Privacy & Utility</CardTitle>
                            <CardDescription>Configure ghost mode and other features for your active session.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2">
                                <Label htmlFor="ghost-mode" className="flex flex-col space-y-1">
                                    <span>Ghost Mode</span>
                                    <span className="font-normal text-xs text-muted-foreground">View status and read messages without sending blue ticks.</span>
                                </Label>
                                <Switch id="ghost-mode" checked={privacyConfig.ghostMode}
                                    onCheckedChange={c => setPrivacyConfig(prev => ({ ...prev, ghostMode: c }))} />
                            </div>

                            <div className="flex items-center justify-between space-x-2">
                                <Label htmlFor="anti-delete" className="flex flex-col space-y-1">
                                    <span>Anti-Delete</span>
                                    <span className="font-normal text-xs text-muted-foreground">Keep messages even if the sender deletes them for everyone.</span>
                                </Label>
                                <Switch id="anti-delete" checked={privacyConfig.antiDelete}
                                    onCheckedChange={c => setPrivacyConfig(prev => ({ ...prev, antiDelete: c }))} />
                            </div>

                            <div className="pt-4">
                                <Button onClick={handleSavePrivacy} disabled={privacyLoading || !sessionId}>
                                    {privacyLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Privacy Settings
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </SessionGuard>
        );
    }
