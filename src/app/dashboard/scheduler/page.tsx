"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Trash2,
    Plus,
    CalendarClock,
    RefreshCw,
    Newspaper,
    Send,
    Users,
    User,
    Repeat,
    Calendar,
    Clock,
    CheckCircle2,
    Sparkles,
    Pencil
} from "lucide-react";
import { toast } from "sonner";
import moment from "moment-timezone";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface ScheduledMessage {
    id: string;
    jid: string;
    recipientName?: string | null;
    content: string;
    sendAt: string;
    status: string;
    repeatType?: string;
    repeatInterval?: number;
    repeatCount?: number | null;
    repeatUntil?: string | null;
    mediaUrl?: string;
    mediaType?: string;
}

interface NewsSubscriber {
    id: string;
    name?: string | null;
    jid: string;
    deliveryTime: string;
    enabled: boolean;
    lastSentAt?: string | null;
}

interface ContactItem {
    jid: string;
    name?: string;
    notify?: string;
}

interface GroupItem {
    jid: string;
    subject: string;
}

export default function SchedulerPage() {
    const { sessionId: selectedSessionId } = useSession();

    // Tab state: 'messages' or 'news'
    const [activeTab, setActiveTab] = useState<"messages" | "news">("messages");

    // Scheduled messages state
    const [messages, setMessages] = useState<ScheduledMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [systemTimezone, setSystemTimezone] = useState("Asia/Kolkata");

    // Contacts and groups cache for easy picking
    const [contacts, setContacts] = useState<ContactItem[]>([]);
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [loadingContacts, setLoadingContacts] = useState(false);

    // Form state for scheduling
    const [showForm, setShowForm] = useState(false);
    const [recipientType, setRecipientType] = useState<"CONTACT" | "GROUP" | "MANUAL">("CONTACT");
    const [newJid, setNewJid] = useState("");
    const [newRecipientName, setNewRecipientName] = useState("");
    const [newContent, setNewContent] = useState("");
    const [newSendAt, setNewSendAt] = useState("");
    const [newRepeatType, setNewRepeatType] = useState("NONE");
    const [newRepeatInterval, setNewRepeatInterval] = useState("1");
    const [repeatDurationType, setRepeatDurationType] = useState<"INDEFINITE" | "COUNT" | "UNTIL">("INDEFINITE");
    const [newRepeatCount, setNewRepeatCount] = useState("");
    const [newRepeatUntil, setNewRepeatUntil] = useState("");
    const [newMediaUrl, setNewMediaUrl] = useState("");
    const [newMediaType, setNewMediaType] = useState("image");

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Edit state
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editJid, setEditJid] = useState("");
    const [editRecipientName, setEditRecipientName] = useState("");
    const [editContent, setEditContent] = useState("");
    const [editSendAt, setEditSendAt] = useState("");
    const [editRepeatType, setEditRepeatType] = useState("NONE");
    const [editRepeatInterval, setEditRepeatInterval] = useState("1");
    const [editRepeatDurationType, setEditRepeatDurationType] = useState<"INDEFINITE" | "COUNT" | "UNTIL">("INDEFINITE");
    const [editRepeatCount, setEditRepeatCount] = useState("");
    const [editRepeatUntil, setEditRepeatUntil] = useState("");
    const [editMediaUrl, setEditMediaUrl] = useState("");
    const [editMediaType, setEditMediaType] = useState("image");

    // Daily News Subscriptions state
    const [subscribers, setSubscribers] = useState<NewsSubscriber[]>([]);
    const [loadingNews, setLoadingNews] = useState(false);
    const [showAddNewsModal, setShowAddNewsModal] = useState(false);
    const [newsRecipientType, setNewsRecipientType] = useState<"CONTACT" | "GROUP" | "MANUAL">("MANUAL");
    const [newNewsJid, setNewNewsJid] = useState("");
    const [newNewsName, setNewNewsName] = useState("");
    const [newNewsTime, setNewNewsTime] = useState("07:30");
    const [testingJid, setTestingJid] = useState<string | null>(null);

    useEffect(() => {
        // Fetch system timezone
        fetch('/api/settings/system')
            .then(res => res.json())
            .then(data => {
                if (data.status && data.data?.timezone) {
                    setSystemTimezone(data.data.timezone);
                }
            })
            .catch(() => { });

        if (selectedSessionId) {
            fetchMessages(selectedSessionId);
            fetchContactsAndGroups(selectedSessionId);
        } else {
            setMessages([]);
        }

        fetchNewsSubscribers();
    }, [selectedSessionId]);

    const fetchContactsAndGroups = async (sessId: string) => {
        setLoadingContacts(true);
        try {
            const [contactsRes, groupsRes] = await Promise.allSettled([
                fetch(`/api/contacts/${sessId}?limit=all`),
                fetch(`/api/groups/${sessId}`)
            ]);

            if (contactsRes.status === "fulfilled" && contactsRes.value.ok) {
                const cData = await contactsRes.value.json();
                const rawList = cData?.data?.contacts || cData?.data || [];
                setContacts(rawList.map((c: any) => ({
                    jid: c.jid,
                    name: c.name || c.notify || c.verifiedName || c.jid.split('@')[0],
                    notify: c.notify
                })));
            }

            if (groupsRes.status === "fulfilled" && groupsRes.value.ok) {
                const gData = await groupsRes.value.json();
                const gList = gData?.data || [];
                setGroups(gList.map((g: any) => ({
                    jid: g.jid,
                    subject: g.subject || g.jid.split('@')[0]
                })));
            }
        } catch (e) {
            console.warn("Failed to load contacts/groups for selector", e);
        } finally {
            setLoadingContacts(false);
        }
    };

    const fetchMessages = async (sessionId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/scheduler/${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                setMessages(data?.data || []);
            } else {
                setMessages([]);
            }
        } catch (error) {
            toast.error("Failed to fetch scheduled messages");
        } finally {
            setLoading(false);
        }
    };

    const fetchNewsSubscribers = async () => {
        setLoadingNews(true);
        try {
            const res = await fetch("/api/news-subscriptions");
            if (res.ok) {
                const data = await res.json();
                setSubscribers(data?.data || []);
            }
        } catch (error) {
            console.error("Failed to fetch news subscribers", error);
        } finally {
            setLoadingNews(false);
        }
    };

    const handleSaveSchedule = async () => {
        if (!selectedSessionId || !newJid || !newContent || !newSendAt) {
            toast.error("Please fill in recipient, message, and scheduled time");
            return;
        }

        let jid = newJid.trim();
        if (!jid.includes("@")) {
            const cleanDigits = jid.replace(/\D/g, "");
            jid = `${cleanDigits}@s.whatsapp.net`;
        }

        const payload: any = {
            jid,
            recipientName: newRecipientName || null,
            content: newContent,
            sendAt: newSendAt,
            mediaUrl: newMediaUrl || null,
            mediaType: newMediaType,
            repeatType: newRepeatType,
            repeatInterval: parseInt(newRepeatInterval, 10) || 1,
            repeatCount: repeatDurationType === "COUNT" && newRepeatCount ? parseInt(newRepeatCount, 10) : null,
            repeatUntil: repeatDurationType === "UNTIL" && newRepeatUntil ? newRepeatUntil : null
        };

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success(newRepeatType !== "NONE" ? "Recurring schedule created" : "Message scheduled");
                setShowForm(false);
                setNewJid("");
                setNewRecipientName("");
                setNewContent("");
                setNewSendAt("");
                setNewRepeatType("NONE");
                setNewRepeatInterval("1");
                setNewRepeatCount("");
                setNewRepeatUntil("");
                setNewMediaUrl("");
                setNewMediaType("image");
                fetchMessages(selectedSessionId);
            } else {
                toast.error("Failed to schedule message");
            }
        } catch (error) {
            toast.error("An error occurred while saving schedule");
        }
    };

    const handleEdit = (msg: ScheduledMessage) => {
        setEditId(msg.id);
        setEditJid(msg.jid);
        setEditRecipientName(msg.recipientName || "");
        setEditContent(msg.content);
        setEditMediaUrl(msg.mediaUrl || "");
        setEditMediaType(msg.mediaType || "image");

        const localIso = moment.tz(msg.sendAt, systemTimezone).format('YYYY-MM-DDTHH:mm');
        setEditSendAt(localIso);

        setEditRepeatType(msg.repeatType || "NONE");
        setEditRepeatInterval(String(msg.repeatInterval || 1));

        if (msg.repeatCount) {
            setEditRepeatDurationType("COUNT");
            setEditRepeatCount(String(msg.repeatCount));
        } else if (msg.repeatUntil) {
            setEditRepeatDurationType("UNTIL");
            setEditRepeatUntil(moment.tz(msg.repeatUntil, systemTimezone).format('YYYY-MM-DDTHH:mm'));
        } else {
            setEditRepeatDurationType("INDEFINITE");
        }

        setIsEditOpen(true);
    };

    const handleUpdateSchedule = async () => {
        if (!selectedSessionId || !editId || !editJid || !editContent || !editSendAt) return;

        let jid = editJid.trim();
        if (!jid.includes("@")) {
            jid = `${jid.replace(/\D/g, "")}@s.whatsapp.net`;
        }

        const payload: any = {
            jid,
            recipientName: editRecipientName || null,
            content: editContent,
            sendAt: editSendAt,
            mediaUrl: editMediaUrl || null,
            mediaType: editMediaType,
            repeatType: editRepeatType,
            repeatInterval: parseInt(editRepeatInterval, 10) || 1,
            repeatCount: editRepeatDurationType === "COUNT" && editRepeatCount ? parseInt(editRepeatCount, 10) : null,
            repeatUntil: editRepeatDurationType === "UNTIL" && editRepeatUntil ? editRepeatUntil : null
        };

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success("Schedule updated successfully");
                setIsEditOpen(false);
                setEditId(null);
                fetchMessages(selectedSessionId);
            } else {
                toast.error("Failed to update schedule");
            }
        } catch (error) {
            toast.error("An error occurred while updating schedule");
        }
    };

    const confirmDelete = async () => {
        if (!deleteId || !selectedSessionId) return;
        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${deleteId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Schedule cancelled");
                setMessages(messages.filter(m => m.id !== deleteId));
            } else {
                toast.error("Failed to cancel schedule");
            }
        } catch (error) {
            toast.error("Failed to cancel schedule");
        } finally {
            setDeleteId(null);
        }
    };

    // News subscription actions
    const handleAddNewsSubscriber = async () => {
        if (!newNewsJid) {
            toast.error("Please enter or select a recipient number or group");
            return;
        }

        try {
            const res = await fetch("/api/news-subscriptions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jid: newNewsJid,
                    name: newNewsName || null,
                    deliveryTime: newNewsTime || "07:30",
                    enabled: true
                })
            });

            if (res.ok) {
                toast.success("News subscriber added");
                setShowAddNewsModal(false);
                setNewNewsJid("");
                setNewNewsName("");
                setNewNewsTime("07:30");
                fetchNewsSubscribers();
            } else {
                toast.error("Failed to add news subscriber");
            }
        } catch (error) {
            toast.error("Error adding subscriber");
        }
    };

    const handleToggleNewsSubscriber = async (id: string, currentEnabled: boolean) => {
        try {
            const res = await fetch(`/api/news-subscriptions/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: !currentEnabled })
            });

            if (res.ok) {
                setSubscribers(subscribers.map(s => s.id === id ? { ...s, enabled: !currentEnabled } : s));
                toast.success(!currentEnabled ? "Subscriber activated" : "Subscriber paused");
            }
        } catch (error) {
            toast.error("Failed to update status");
        }
    };

    const handleDeleteNewsSubscriber = async (id: string) => {
        try {
            const res = await fetch(`/api/news-subscriptions/${id}`, { method: "DELETE" });
            if (res.ok) {
                setSubscribers(subscribers.filter(s => s.id !== id));
                toast.success("Subscriber removed");
            }
        } catch (error) {
            toast.error("Failed to remove subscriber");
        }
    };

    const handleTestSendNews = async (jid: string) => {
        setTestingJid(jid);
        toast.info("Fetching live headlines & sending morning briefing...");
        try {
            const res = await fetch("/api/news-subscriptions/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jid })
            });

            const data = await res.json();
            if (res.ok && data.status) {
                toast.success("Live news briefing delivered successfully!");
            } else {
                toast.error(data.message || "Failed to send news briefing");
            }
        } catch (error) {
            toast.error("Failed to trigger live test");
        } finally {
            setTestingJid(null);
        }
    };

    const filteredMessages = messages.filter(m =>
        m.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.jid.includes(searchTerm) ||
        (m.recipientName && m.recipientName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <SessionGuard>
            <div className="space-y-6">
                {/* Header with Navigation Pills */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <CalendarClock className="h-6 w-6 text-primary" /> Scheduler & Automation
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Schedule recurring messages for groups/contacts and manage daily automated news briefings.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                if (activeTab === "messages" && selectedSessionId) fetchMessages(selectedSessionId);
                                if (activeTab === "news") fetchNewsSubscribers();
                            }}
                            disabled={loading || loadingNews}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${loading || loadingNews ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>

                        {activeTab === "messages" ? (
                            <Button
                                size="sm"
                                onClick={() => {
                                    setNewJid("");
                                    setNewRecipientName("");
                                    setNewContent("");
                                    setNewSendAt("");
                                    setNewRepeatType("NONE");
                                    setShowForm(!showForm);
                                }}
                                disabled={!selectedSessionId}
                            >
                                <Plus className="h-4 w-4 mr-2" /> Schedule Message
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                onClick={() => {
                                    setNewNewsJid("");
                                    setNewNewsName("");
                                    setNewNewsTime("07:30");
                                    setShowAddNewsModal(true);
                                }}
                            >
                                <Plus className="h-4 w-4 mr-2" /> Add News Subscriber
                            </Button>
                        )}
                    </div>
                </div>

                {/* Tabs Segmented Control */}
                <div className="flex bg-muted/60 p-1 rounded-xl max-w-md border">
                    <button
                        onClick={() => setActiveTab("messages")}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-semibold rounded-lg transition-all ${
                            activeTab === "messages"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <CalendarClock className="h-4 w-4" />
                        <span>Scheduled Messages</span>
                        {messages.length > 0 && (
                            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                                {messages.length}
                            </Badge>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab("news")}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-semibold rounded-lg transition-all ${
                            activeTab === "news"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Newspaper className="h-4 w-4" />
                        <span>Daily News Digest</span>
                        {subscribers.length > 0 && (
                            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                                {subscribers.length}
                            </Badge>
                        )}
                    </button>
                </div>

                {/* TAB 1: SCHEDULED MESSAGES */}
                {activeTab === "messages" && (
                    <div className="space-y-6">
                        <SearchFilter
                            placeholder="Search scheduled messages by recipient, contact, or content..."
                            onSearch={setSearchTerm}
                        />

                        {/* Create Schedule Card Form */}
                        {showForm && (
                            <Card className="border-2 border-primary/30 shadow-md">
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Calendar className="h-5 w-5 text-primary" /> Create Scheduled Message
                                    </CardTitle>
                                    <CardDescription>
                                        Pick a contact, group, or enter a number, then set send time and repeating frequency.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-5">
                                    {/* 1. Recipient Target Selector */}
                                    <div className="space-y-3 p-4 rounded-xl bg-muted/40 border">
                                        <Label className="font-semibold text-sm">Select Recipient Target</Label>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={recipientType === "CONTACT" ? "default" : "outline"}
                                                onClick={() => {
                                                    setRecipientType("CONTACT");
                                                    setNewJid("");
                                                    setNewRecipientName("");
                                                }}
                                                className="flex-1"
                                            >
                                                <User className="h-4 w-4 mr-1.5" /> Contact Person
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={recipientType === "GROUP" ? "default" : "outline"}
                                                onClick={() => {
                                                    setRecipientType("GROUP");
                                                    setNewJid("");
                                                    setNewRecipientName("");
                                                }}
                                                className="flex-1"
                                            >
                                                <Users className="h-4 w-4 mr-1.5" /> WhatsApp Group
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={recipientType === "MANUAL" ? "default" : "outline"}
                                                onClick={() => {
                                                    setRecipientType("MANUAL");
                                                    setNewJid("");
                                                    setNewRecipientName("");
                                                }}
                                                className="flex-1"
                                            >
                                                Manual Number
                                            </Button>
                                        </div>

                                        {recipientType === "CONTACT" && (
                                            <div className="space-y-2 mt-2">
                                                <Label className="text-xs text-muted-foreground">Choose from synced Contacts ({contacts.length} available)</Label>
                                                <Select onValueChange={(val) => {
                                                    const selected = contacts.find(c => c.jid === val);
                                                    setNewJid(val);
                                                    setNewRecipientName(selected?.name || val.split('@')[0]);
                                                }}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Pick a contact person..." />
                                                    </SelectTrigger>
                                                    <SelectContent className="max-h-64">
                                                        {contacts.map((c) => (
                                                            <SelectItem key={c.jid} value={c.jid}>
                                                                {c.name} ({c.jid.split('@')[0]})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}

                                        {recipientType === "GROUP" && (
                                            <div className="space-y-2 mt-2">
                                                <Label className="text-xs text-muted-foreground">Choose from synced WhatsApp Groups ({groups.length} available)</Label>
                                                <Select onValueChange={(val) => {
                                                    const selected = groups.find(g => g.jid === val);
                                                    setNewJid(val);
                                                    setNewRecipientName(selected?.subject || "Group");
                                                }}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Pick a WhatsApp group..." />
                                                    </SelectTrigger>
                                                    <SelectContent className="max-h-64">
                                                        {groups.map((g) => (
                                                            <SelectItem key={g.jid} value={g.jid}>
                                                                👥 {g.subject}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}

                                        {recipientType === "MANUAL" && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                                <div>
                                                    <Label className="text-xs text-muted-foreground">Recipient Phone Number / JID</Label>
                                                    <Input
                                                        value={newJid}
                                                        onChange={e => setNewJid(e.target.value)}
                                                        placeholder="e.g. 919876543210"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-xs text-muted-foreground">Recipient Name (Optional)</Label>
                                                    <Input
                                                        value={newRecipientName}
                                                        onChange={e => setNewRecipientName(e.target.value)}
                                                        placeholder="e.g. John Doe"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {newJid && (
                                            <div className="text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
                                                <CheckCircle2 className="h-4 w-4" />
                                                Target: <strong className="font-semibold">{newRecipientName || newJid.split('@')[0]}</strong> ({newJid})
                                            </div>
                                        )}
                                    </div>

                                    {/* 2. Schedule Timing & Recurrence */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-1.5">
                                                <Clock className="h-4 w-4 text-muted-foreground" /> Start Date & Time
                                            </Label>
                                            <Input
                                                type="datetime-local"
                                                value={newSendAt}
                                                onChange={e => setNewSendAt(e.target.value)}
                                            />
                                            <p className="text-xs text-muted-foreground">Timezone: {systemTimezone}</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-1.5">
                                                <Repeat className="h-4 w-4 text-muted-foreground" /> Repeat Schedule
                                            </Label>
                                            <Select value={newRepeatType} onValueChange={setNewRepeatType}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="NONE">Does Not Repeat (Once)</SelectItem>
                                                    <SelectItem value="DAILY">Daily (Every Day)</SelectItem>
                                                    <SelectItem value="WEEKLY">Weekly (Every Week)</SelectItem>
                                                    <SelectItem value="CUSTOM">Custom Interval (Every X Days)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {/* Custom recurrence options */}
                                    {newRepeatType !== "NONE" && (
                                        <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 space-y-3 animate-in fade-in duration-200">
                                            <div className="font-semibold text-sm text-blue-900 dark:text-blue-300 flex items-center gap-2">
                                                <Repeat className="h-4 w-4" /> Recurrence Settings
                                            </div>

                                            {newRepeatType === "CUSTOM" && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Repeat Every (Days):</Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="365"
                                                        value={newRepeatInterval}
                                                        onChange={e => setNewRepeatInterval(e.target.value)}
                                                        className="w-32"
                                                    />
                                                </div>
                                            )}

                                            <div className="space-y-2">
                                                <Label className="text-xs">How long should this schedule repeat?</Label>
                                                <div className="flex gap-2">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={repeatDurationType === "INDEFINITE" ? "default" : "outline"}
                                                        onClick={() => setRepeatDurationType("INDEFINITE")}
                                                        className="text-xs"
                                                    >
                                                        Indefinite (Until stopped)
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={repeatDurationType === "COUNT" ? "default" : "outline"}
                                                        onClick={() => setRepeatDurationType("COUNT")}
                                                        className="text-xs"
                                                    >
                                                        Specific # of times
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={repeatDurationType === "UNTIL" ? "default" : "outline"}
                                                        onClick={() => setRepeatDurationType("UNTIL")}
                                                        className="text-xs"
                                                    >
                                                        Until End Date
                                                    </Button>
                                                </div>

                                                {repeatDurationType === "COUNT" && (
                                                    <div className="space-y-1 pt-2">
                                                        <Label className="text-xs">Total number of times to send (e.g. 5 days):</Label>
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            max="1000"
                                                            placeholder="e.g. 5"
                                                            value={newRepeatCount}
                                                            onChange={e => setNewRepeatCount(e.target.value)}
                                                            className="w-36"
                                                        />
                                                    </div>
                                                )}

                                                {repeatDurationType === "UNTIL" && (
                                                    <div className="space-y-1 pt-2">
                                                        <Label className="text-xs">Stop repeating after date:</Label>
                                                        <Input
                                                            type="datetime-local"
                                                            value={newRepeatUntil}
                                                            onChange={e => setNewRepeatUntil(e.target.value)}
                                                            className="max-w-xs"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* 3. Message Body */}
                                    <div className="space-y-2">
                                        <Label>Message Content</Label>
                                        <Textarea
                                            value={newContent}
                                            onChange={e => setNewContent(e.target.value)}
                                            placeholder="Write your automated message here..."
                                            rows={4}
                                        />
                                    </div>

                                    {/* 4. Optional Media */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <Label>Media URL (Optional)</Label>
                                            <Input
                                                value={newMediaUrl}
                                                onChange={e => setNewMediaUrl(e.target.value)}
                                                placeholder="https://example.com/image.jpg"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Media Type</Label>
                                            <Select value={newMediaType} onValueChange={setNewMediaType}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="image">Image</SelectItem>
                                                    <SelectItem value="video">Video</SelectItem>
                                                    <SelectItem value="document">Document</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-2 pt-2">
                                        <Button variant="ghost" onClick={() => setShowForm(false)}>
                                            Cancel
                                        </Button>
                                        <Button onClick={handleSaveSchedule} className="bg-primary">
                                            <Send className="h-4 w-4 mr-2" /> Save & Schedule
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Scheduled Messages List */}
                        {loading ? (
                            <div className="text-center p-12 text-muted-foreground">Loading schedules...</div>
                        ) : filteredMessages.length === 0 ? (
                            <div className="text-center p-12 text-muted-foreground border rounded-2xl bg-muted/20">
                                {selectedSessionId
                                    ? "No scheduled messages found. Click '+ Schedule Message' to create one."
                                    : "No session selected. Please pick an active session above."}
                            </div>
                        ) : (
                            <div className="grid gap-4">
                                {filteredMessages.map(msg => {
                                    const isGroup = msg.jid.endsWith("@g.us");
                                    const repeatLabel =
                                        msg.repeatType === "DAILY" ? "Repeats Daily" :
                                        msg.repeatType === "WEEKLY" ? "Repeats Weekly" :
                                        msg.repeatType === "CUSTOM" ? `Repeats every ${msg.repeatInterval} days` :
                                        null;

                                    return (
                                        <Card key={msg.id} className="hover:border-primary/40 transition-all shadow-sm">
                                            <CardContent className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4">
                                                <div className="space-y-1.5 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-bold text-base flex items-center gap-1.5">
                                                            {isGroup ? <Users className="h-4 w-4 text-blue-500" /> : <User className="h-4 w-4 text-emerald-500" />}
                                                            {msg.recipientName || msg.jid.split('@')[0]}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground">({msg.jid.split('@')[0]})</span>

                                                        <Badge
                                                            variant="outline"
                                                            className={
                                                                msg.status === "PENDING" ? "bg-amber-500/10 text-amber-700 border-amber-300" :
                                                                msg.status === "SENT" ? "bg-emerald-500/10 text-emerald-700 border-emerald-300" :
                                                                msg.status === "COMPLETED" ? "bg-blue-500/10 text-blue-700 border-blue-300" :
                                                                "bg-red-500/10 text-red-700 border-red-300"
                                                            }
                                                        >
                                                            {msg.status}
                                                        </Badge>

                                                        {repeatLabel && (
                                                            <Badge variant="secondary" className="text-xs flex items-center gap-1">
                                                                <Repeat className="h-3 w-3" /> {repeatLabel}
                                                                {msg.repeatCount ? ` (${msg.repeatCount} left)` : ""}
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    <p className="text-sm font-medium line-clamp-2 text-foreground/90">
                                                        {msg.content}
                                                    </p>

                                                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="h-3.5 w-3.5" /> Next: {new Date(msg.sendAt).toLocaleString()}
                                                        </span>
                                                        {msg.repeatUntil && (
                                                            <span>• Until: {new Date(msg.repeatUntil).toLocaleDateString()}</span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 self-end sm:self-center">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleEdit(msg)}
                                                        disabled={msg.status !== 'PENDING'}
                                                    >
                                                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setDeleteId(msg.id)}
                                                        className="text-destructive hover:bg-destructive/10"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 2: DAILY NEWS DIGEST */}
                {activeTab === "news" && (
                    <div className="space-y-6">
                        {/* News Feature Banner */}
                        <Card className="bg-gradient-to-br from-emerald-500/10 via-background to-blue-500/10 border-primary/20">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Sparkles className="h-5 w-5 text-emerald-600" /> Automated Daily News Briefing
                                </CardTitle>
                                <CardDescription>
                                    Every morning, the gateway automatically compiles top headlines covering <strong>India</strong>, <strong>Global</strong>, and <strong>Tech/Business</strong>, formatting and sending them directly via WhatsApp at each subscriber&apos;s preferred time (IST).
                                </CardDescription>
                            </CardHeader>
                        </Card>

                        {/* News Subscribers List */}
                        {loadingNews ? (
                            <div className="text-center p-12 text-muted-foreground">Loading news subscribers...</div>
                        ) : subscribers.length === 0 ? (
                            <div className="text-center p-12 text-muted-foreground border rounded-2xl bg-muted/20">
                                No news subscribers yet. Click &apos;+ Add News Subscriber&apos; to add one.
                            </div>
                        ) : (
                            <div className="grid gap-4">
                                {subscribers.map(sub => {
                                    const isGroup = sub.jid.endsWith("@g.us");
                                    return (
                                        <Card key={sub.id} className="shadow-sm hover:border-primary/40 transition-all">
                                            <CardContent className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4">
                                                <div className="space-y-1 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-bold text-base flex items-center gap-1.5">
                                                            {isGroup ? <Users className="h-4 w-4 text-blue-500" /> : <User className="h-4 w-4 text-emerald-500" />}
                                                            {sub.name || sub.jid.split('@')[0]}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground">({sub.jid})</span>

                                                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/30 flex items-center gap-1 text-xs">
                                                            <Clock className="h-3 w-3" /> {sub.deliveryTime} IST
                                                        </Badge>

                                                        <Badge
                                                            variant="outline"
                                                            className={sub.enabled ? "bg-emerald-500/10 text-emerald-700 border-emerald-300" : "bg-muted text-muted-foreground"}
                                                        >
                                                            {sub.enabled ? "Active" : "Paused"}
                                                        </Badge>
                                                    </div>

                                                    <p className="text-xs text-muted-foreground">
                                                        {sub.lastSentAt ? `Last briefing delivered on ${new Date(sub.lastSentAt).toLocaleString()}` : "Pending first delivery"}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-3 self-end sm:self-center">
                                                    {/* Active Toggle Switch */}
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-xs cursor-pointer" htmlFor={`switch-${sub.id}`}>
                                                            {sub.enabled ? "Enabled" : "Paused"}
                                                        </Label>
                                                        <Switch
                                                            id={`switch-${sub.id}`}
                                                            checked={sub.enabled}
                                                            onCheckedChange={() => handleToggleNewsSubscriber(sub.id, sub.enabled)}
                                                        />
                                                    </div>

                                                    {/* Test Send Button */}
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleTestSendNews(sub.jid)}
                                                        disabled={testingJid === sub.jid}
                                                    >
                                                        {testingJid === sub.jid ? (
                                                            <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                                        ) : (
                                                            <Send className="h-3.5 w-3.5 mr-1.5" />
                                                        )}
                                                        Send Now
                                                    </Button>

                                                    {/* Delete Button */}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDeleteNewsSubscriber(sub.id)}
                                                        className="text-destructive hover:bg-destructive/10"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* MODAL: ADD NEWS SUBSCRIBER */}
                <Dialog open={showAddNewsModal} onOpenChange={setShowAddNewsModal}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Newspaper className="h-5 w-5 text-primary" /> Add News Subscriber
                            </DialogTitle>
                            <DialogDescription>
                                Add a contact or group to receive automated daily morning news briefings at a set time.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-3">
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Select Target Source</Label>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={newsRecipientType === "MANUAL" ? "default" : "outline"}
                                        onClick={() => {
                                            setNewsRecipientType("MANUAL");
                                            setNewNewsJid("");
                                            setNewNewsName("");
                                        }}
                                        className="flex-1 text-xs"
                                    >
                                        Phone Number
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={newsRecipientType === "CONTACT" ? "default" : "outline"}
                                        onClick={() => {
                                            setNewsRecipientType("CONTACT");
                                            setNewNewsJid("");
                                            setNewNewsName("");
                                        }}
                                        className="flex-1 text-xs"
                                    >
                                        Contact
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={newsRecipientType === "GROUP" ? "default" : "outline"}
                                        onClick={() => {
                                            setNewsRecipientType("GROUP");
                                            setNewNewsJid("");
                                            setNewNewsName("");
                                        }}
                                        className="flex-1 text-xs"
                                    >
                                        Group
                                    </Button>
                                </div>
                            </div>

                            {newsRecipientType === "CONTACT" && (
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Select Contact ({contacts.length} available)</Label>
                                    <Select onValueChange={(val) => {
                                        const c = contacts.find(item => item.jid === val);
                                        setNewNewsJid(val);
                                        setNewNewsName(c?.name || val.split('@')[0]);
                                    }}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Pick a contact..." />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-56">
                                            {contacts.map((c) => (
                                                <SelectItem key={c.jid} value={c.jid}>
                                                    {c.name} ({c.jid.split('@')[0]})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {newsRecipientType === "GROUP" && (
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Select WhatsApp Group ({groups.length} available)</Label>
                                    <Select onValueChange={(val) => {
                                        const g = groups.find(item => item.jid === val);
                                        setNewNewsJid(val);
                                        setNewNewsName(g?.subject || "Group");
                                    }}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Pick a group..." />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-56">
                                            {groups.map((g) => (
                                                <SelectItem key={g.jid} value={g.jid}>
                                                    👥 {g.subject}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {newsRecipientType === "MANUAL" && (
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">WhatsApp Number</Label>
                                    <Input
                                        placeholder="e.g. 919876543210"
                                        value={newNewsJid}
                                        onChange={e => setNewNewsJid(e.target.value)}
                                    />
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Subscriber / Friendly Name</Label>
                                <Input
                                    placeholder="e.g. Personal WhatsApp, Dad, Office Team"
                                    value={newNewsName}
                                    onChange={e => setNewNewsName(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Daily Delivery Time (IST)</Label>
                                <Input
                                    type="time"
                                    value={newNewsTime}
                                    onChange={e => setNewNewsTime(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    News digest will be automatically fetched and delivered every day at this time.
                                </p>
                            </div>
                        </div>

                        <DialogFooter className="gap-2">
                            <Button variant="ghost" onClick={() => setShowAddNewsModal(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddNewsSubscriber}>
                                Save Subscriber
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* MODAL: DELETE CONFIRMATION */}
                <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Cancel Schedule?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently cancel and remove this scheduled message.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* MODAL: EDIT SCHEDULE */}
                <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
                    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Pencil className="h-5 w-5 text-primary" /> Edit Scheduled Message
                            </DialogTitle>
                            <DialogDescription>Modify timing, recipient, repeat frequency, or message content.</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label className="text-xs">Recipient JID</Label>
                                    <Input
                                        value={editJid}
                                        onChange={e => setEditJid(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Recipient Name</Label>
                                    <Input
                                        value={editRecipientName}
                                        onChange={e => setEditRecipientName(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label className="text-xs">Send At</Label>
                                    <Input
                                        type="datetime-local"
                                        value={editSendAt}
                                        onChange={e => setEditSendAt(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Repeat Frequency</Label>
                                    <Select value={editRepeatType} onValueChange={setEditRepeatType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="NONE">Does Not Repeat (Once)</SelectItem>
                                            <SelectItem value="DAILY">Daily (Every Day)</SelectItem>
                                            <SelectItem value="WEEKLY">Weekly (Every Week)</SelectItem>
                                            <SelectItem value="CUSTOM">Custom Interval</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {editRepeatType === "CUSTOM" && (
                                <div className="space-y-1">
                                    <Label className="text-xs">Interval (Days):</Label>
                                    <Input
                                        type="number"
                                        value={editRepeatInterval}
                                        onChange={e => setEditRepeatInterval(e.target.value)}
                                        className="w-32"
                                    />
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label className="text-xs">Message</Label>
                                <Textarea
                                    value={editContent}
                                    onChange={e => setEditContent(e.target.value)}
                                    rows={4}
                                />
                            </div>
                        </div>

                        <DialogFooter className="gap-2">
                            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                            <Button onClick={handleUpdateSchedule}>Save Changes</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
