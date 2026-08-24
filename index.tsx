/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings, Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Button, ChannelStore, FluxDispatcher, Forms, GuildStore, Menu, Modal, openModal, PresenceStore, React, TextInput, UserStore } from "@webpack/common";

const LOG_TYPE_CONFIG = {
    activity: {
        icon: "🎮",
        color: "#5865F2",
        bgColor: "rgba(88, 101, 242, 0.1)",
        label: "Activity"
    },
    voice: {
        icon: "🔊",
        color: "#57F287",
        bgColor: "rgba(87, 242, 135, 0.1)",
        label: "Voice"
    },
    message: {
        icon: "💬",
        color: "#FEE75C",
        bgColor: "rgba(254, 231, 92, 0.1)",
        label: "Message"
    },
    status: {
        icon: "🟢",
        color: "#EB459E",
        bgColor: "rgba(235, 69, 158, 0.1)",
        label: "Status"
    }
};

interface Activity {
    name: string;
    type: number;
    details?: string;
    state?: string;
    timestamps?: {
        start?: number;
        end?: number;
    };
    application_id?: string;
    assets?: {
        large_image?: string;
        large_text?: string;
        small_image?: string;
        small_text?: string;
    };
}

interface ActivityLog {
    userId: string;
    username: string;
    timestamp: number;
    type: "activity" | "voice" | "message" | "status";
    activities?: Activity[];
    voiceChannel?: {
        channelId: string;
        channelName: string;
        action: "join" | "leave" | "move";
        guildId: string;
        guildName: string;
    };
    message?: {
        content: string;
        channelId: string;
        channelName?: string;
        guildId?: string;
        guildName?: string;
    };
    status?: {
        status: string;
        clientStatus?: any;
    };
}

let activityLogs: ActivityLog[] = [];
const MAX_LOGS = 1000;
const MAX_MESSAGE_CONTENT = 200;
const SAVE_DEBOUNCE_MS = 300;
let trackedUserIds = new Set<string>();

const AVATAR_COLORS = ["#5865F2", "#EB459E", "#FAA61A", "#57F287", "#F23F43", "#9B59B6", "#1ABC9C", "#E91E63"];

function avatarColor(userId: string): string {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function shadeColor(hex: string, amt: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function UserAvatar({ userId, name, size }: { userId: string; name?: string; size: number }) {
    const user = UserStore.getUser(userId);
    if (user) {
        return <img src={user.getAvatarURL(void 0, size * 2, true)} style={{ width: `${size}px`, height: `${size}px`, borderRadius: "50%", display: "block" }} alt="" />;
    }
    const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
    const base = avatarColor(userId);
    return (
        <div style={{
            width: `${size}px`, height: `${size}px`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, position: "relative", overflow: "hidden",
            background: `radial-gradient(circle at 30% 25%, ${shadeColor(base, 48)} 0%, ${base} 48%, ${shadeColor(base, -52)} 100%)`,
            boxShadow: `inset 0 0 0 1.5px ${base}66, inset 0 0 0 2.5px rgba(255,255,255,0.14), inset 0 -6px 10px rgba(0,0,0,0.35), 0 2px 5px rgba(0,0,0,0.4)`,
            color: "#FFFFFF", userSelect: "none"
        }}>
            <span style={{
                position: "relative", zIndex: 1, fontSize: `${Math.round(size * 0.46)}px`, fontWeight: "800",
                letterSpacing: "0.5px", textShadow: "0 1px 3px rgba(0,0,0,0.55)", lineHeight: 1
            }}>{initial}</span>
            <div style={{
                position: "absolute", top: 0, left: 0, width: `${size}px`, height: `${Math.round(size * 0.42)}px`, borderRadius: "50% 50% 0 0",
                background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 100%)", pointerEvents: "none"
            }} />
        </div>
    );
}
function ActivityLogo({ size = 28 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", borderRadius: "22%" }}>
            <defs>
                <linearGradient id="at-logo-bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#7983F5" />
                    <stop offset="55%" stopColor="#5865F2" />
                    <stop offset="100%" stopColor="#3B45C4" />
                </linearGradient>
                <linearGradient id="at-logo-shine" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </linearGradient>
            </defs>
            <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#at-logo-bg)" />
            <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#at-logo-shine)" />
            <rect x="4" y="4" width="120" height="120" rx="30" fill="none" stroke="#FFFFFF" strokeOpacity="0.15" strokeWidth="2" />
            <g opacity="0.35">
                <circle cx="22" cy="26" r="3" fill="#FFFFFF" />
                <circle cx="38" cy="20" r="2.5" fill="#FFFFFF" />
                <circle cx="104" cy="24" r="2.5" fill="#FFFFFF" />
                <circle cx="110" cy="46" r="3" fill="#FFFFFF" />
                <circle cx="20" cy="58" r="2.5" fill="#FFFFFF" />
            </g>
            <g stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round">
                <line x1="64" y1="16" x2="64" y2="28" />
                <line x1="64" y1="100" x2="64" y2="112" />
                <line x1="16" y1="64" x2="28" y2="64" />
                <line x1="100" y1="64" x2="112" y2="64" />
            </g>
            <path d="M24 64 Q64 32 104 64 Q64 96 24 64 Z" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="64" cy="64" r="16" fill="#FFFFFF" />
            <circle cx="64" cy="64" r="8.5" fill="#3B45C4" />
            <circle cx="64" cy="64" r="16" fill="none" stroke="#3B45C4" strokeWidth="2.5" opacity="0.55" />
            <circle cx="60" cy="60" r="2.5" fill="#FFFFFF" />
        </svg>
    );
}

const processedMessageIds = new Set<string>();
const lastKnownStatus = new Map<string, string>();
const lastKnownActivities = new Map<string, string>();
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function shouldBeNative() {
    if (typeof Notification === "undefined") return false;
    const { useNative } = Settings.notifications;
    if (useNative === "always") return true;
    if (useNative === "not-focused") return !document.hasFocus();
    return false;
}

const getRichBody = (user: User, text: string | React.ReactNode) => <div
    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
    <div style={{ position: "relative" }}>
        <img src={user.getAvatarURL(void 0, 80, true)}
            style={{ width: "80px", height: "80px", borderRadius: "15%" }} alt={`${user.username}'s avatar`} />
    </div>
    <span>{text}</span>
</div>;

// Load data from settings
function loadFromSettings() {
    try {
        if (settings.store.trackedUsers) {
            trackedUserIds = new Set(JSON.parse(settings.store.trackedUsers));
        }
        if (settings.store.activityLogs) {
            activityLogs = JSON.parse(settings.store.activityLogs);
        }
        if (settings.store.lastStatuses) {
            lastKnownStatus.clear();
            for (const [id, status] of Object.entries(JSON.parse(settings.store.lastStatuses))) {
                lastKnownStatus.set(id, status as string);
            }
        }
        console.log("[ActivityTracker] Loaded from storage:", activityLogs.length, "logs,", trackedUserIds.size, "tracked users");
    } catch (e) {
        console.error("[ActivityTracker] Failed to load data:", e);
    }
}

// Save data to settings
function saveToSettings() {
    try {
        settings.store.trackedUsers = JSON.stringify(Array.from(trackedUserIds));
        settings.store.activityLogs = JSON.stringify(activityLogs);
        settings.store.lastStatuses = JSON.stringify(Object.fromEntries(lastKnownStatus));
    } catch (e) {
        console.error("[ActivityTracker] Failed to save data:", e);
    }
}

// Debounce writes so bursts of events (e.g. presence heartbeats) do not
// serialize the whole log array into the settings store on every single event.
function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveToSettings, SAVE_DEBOUNCE_MS);
}

function flushSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        saveToSettings();
    }
}

window.addEventListener("beforeunload", flushSave);

const settings = definePluginSettings({
    notifyStatus: {
        type: OptionType.BOOLEAN,
        description: "Notify on status changes",
        restartNeeded: false,
        default: true
    },
    notifyVoice: {
        type: OptionType.BOOLEAN,
        description: "Notify on voice channel changes",
        restartNeeded: false,
        default: false
    },
    persistNotifications: {
        type: OptionType.BOOLEAN,
        description: "Persist notifications",
        restartNeeded: false,
        default: false
    },
    trackedUsers: {
        type: OptionType.STRING,
        description: "Tracked user IDs (internal use)",
        default: "",
        hidden: true
    },
    activityLogs: {
        type: OptionType.STRING,
        description: "Activity logs data (internal use)",
        default: "",
        hidden: true
    },
    lastStatuses: {
        type: OptionType.STRING,
        description: "Last known user statuses (internal use)",
        default: "{}",
        hidden: true
    }
});

const TYPE_FILTERS: Array<{ id: "all" | ActivityLog["type"]; label: string; icon: string }> = [
    { id: "all", label: "All", icon: "📋" },
    { id: "activity", label: "Activity", icon: "🎮" },
    { id: "voice", label: "Voice", icon: "🔊" },
    { id: "message", label: "Message", icon: "💬" },
    { id: "status", label: "Status", icon: "🟢" }
];

function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

function downloadText(filename: string, text: string, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportJSON(logs: ActivityLog[]) {
    downloadText(`activity-logs-${Date.now()}.json`, JSON.stringify(logs, null, 2), "application/json");
}

function exportTXT(logs: ActivityLog[]) {
    const lines = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleString();
        if (log.type === "activity") return `${log.username} - Activity - ${time}: ${(log.activities || []).map(a => a.name).join(", ")}`;
        if (log.type === "voice" && log.voiceChannel) return `${log.username} - Voice - ${time}: ${log.voiceChannel.action} "${log.voiceChannel.channelName}" in "${log.voiceChannel.guildName || "Unknown Server"}"`;
        if (log.type === "message" && log.message) return `${log.username} - Message - ${time}: ${log.message.content}`;
        if (log.type === "status" && log.status) return `${log.username} - Status - ${time}: ${log.status.status}`;
        return `${log.username} - ${log.type} - ${time}`;
    }).join("\n");
    downloadText(`activity-logs-${Date.now()}.txt`, `Activity Tracker Logs\n${"=".repeat(50)}\n\n${lines}\n`);
}

function exportCSV(logs: ActivityLog[]) {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
        ["timestamp", "date", "type", "username", "userId", "detail"].join(","),
        ...logs.map(log => {
            let detail = "";
            if (log.type === "activity") detail = (log.activities || []).map(a => `${a.name}${a.details ? ` (${a.details})` : ""}`).join("; ");
            else if (log.type === "voice" && log.voiceChannel) detail = `${log.voiceChannel.action} ${log.voiceChannel.channelName} (${log.voiceChannel.guildName || ""})`;
            else if (log.type === "message" && log.message) detail = log.message.content;
            else if (log.type === "status" && log.status) detail = log.status.status;
            return [String(log.timestamp), new Date(log.timestamp).toISOString(), log.type, escape(log.username), log.userId, escape(detail)].join(",");
        })
    ];
    downloadText(`activity-logs-${Date.now()}.csv`, rows.join("\n"), "text/csv");
}

interface Stats {
    totalLogs: number;
    messageCount: number;
    activityCount: number;
    voiceCount: number;
    statusCount: number;
    totalVoiceMinutes: number;
    mostActiveHour: string;
    hourCounts: Record<number, number>;
    heatmapData: Record<string, number>;
}

function calculateStats(logs: ActivityLog[]): Stats {
    let messageCount = 0;
    let activityCount = 0;
    let voiceCount = 0;
    let statusCount = 0;
    const hourCounts: Record<number, number> = {};
    const heatmapData: Record<string, number> = {};
    let totalVoiceMinutes = 0;
    let lastJoinTime: number | null = null;

    for (const log of logs) {
        if (log.type === "message") messageCount++;
        else if (log.type === "activity") activityCount++;
        else if (log.type === "voice") voiceCount++;
        else if (log.type === "status") statusCount++;

        const date = new Date(log.timestamp);
        const hour = date.getHours();
        hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
        heatmapData[`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${hour}`] = (heatmapData[`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${hour}`] ?? 0) + 1;

        if (log.type === "voice" && log.voiceChannel) {
            if (log.voiceChannel.action === "join") {
                lastJoinTime = log.timestamp;
            } else if (log.voiceChannel.action === "leave" && lastJoinTime !== null) {
                totalVoiceMinutes += (log.timestamp - lastJoinTime) / 60000;
                lastJoinTime = null;
            }
        }
    }

    const mostActiveHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

    return {
        totalLogs: logs.length,
        messageCount,
        activityCount,
        voiceCount,
        statusCount,
        totalVoiceMinutes: Math.round(totalVoiceMinutes),
        mostActiveHour: mostActiveHour && mostActiveHour[1] > 0
            ? `${mostActiveHour[0]}:00 (${mostActiveHour[1]} events)`
            : "N/A",
        hourCounts,
        heatmapData
    };
}

function StatTile({ label, value, color, icon }: { label: string; value: number | string; color: string; icon?: string }) {
    return (
        <div style={{
            flex: 1, minWidth: "72px",
            background: `linear-gradient(135deg, ${color}12 0%, ${color}04 100%)`,
            border: `1px solid ${color}28`,
            padding: "12px 8px", borderRadius: "12px", textAlign: "center"
        }}>
            <div style={{ fontSize: "20px", lineHeight: 1, marginBottom: "4px" }}>{icon}</div>
            <div style={{ fontSize: "22px", fontWeight: "800", color, lineHeight: 1.2 }}>{value}</div>
            <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "5px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
        </div>
    );
}

function WeekHeatmap({ heatmapData, sessions }: { heatmapData: Record<string, number>; sessions: VoiceSession[] }) {
    const [weekOffset, setWeekOffset] = React.useState(0);
    const [pinned, setPinned] = React.useState<{ di: number; hour: number } | null>(null);
    const [hoverTip, setHoverTip] = React.useState<{ text: string; x: number; y: number } | null>(null);
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Anchor = Sunday of the week that is `weekOffset` weeks before this week
    const anchor = new Date(today);
    anchor.setDate(anchor.getDate() - weekOffset * 7);
    const sunday = new Date(anchor);
    sunday.setDate(anchor.getDate() - anchor.getDay());

    const days: Date[] = [...Array(7)].map((_, i) => {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        return d;
    });

    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const max = Math.max(...Object.values(heatmapData), 0);
    const isCurrentWeek = weekOffset === 0;
    const weekLabel = `week of ${MONTHS[days[0].getMonth()]} ${days[0].getDate()}`;

    const channels = React.useMemo(
        () => [...new Set(sessions.map(s => s.channelName))],
        [sessions]
    );

    // Voice sessions overlapping the given hour (in that day)
    const sessionsInHour = (day: Date, hour: number): VoiceSession[] => {
        const start = day.getTime() + hour * 3600e3;
        const end = start + 3600e3;
        return sessions.filter(s => {
            const sEnd = s.endedAt ?? Date.now();
            return s.startedAt < end && sEnd > start;
        });
    };

    const hourTooltip = (d: Date, hour: number, count: number): string => {
        const hourStart = d.getTime() + hour * 3600e3;
        const hourEnd = hourStart + 3600e3;
        const lines = [`${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} ${String(hour).padStart(2, "0")}:00`];
        if (count > 0) lines.push(`${count} event${count !== 1 ? "s" : ""}`);
        for (const s of sessionsInHour(d, hour)) {
            const sEnd = s.endedAt ?? Date.now();
            const winStart = Math.max(s.startedAt, hourStart);
            const winEnd = Math.min(sEnd, hourEnd);
            const winMs = Math.max(0, winEnd - winStart);
            const server = s.guildName && s.guildName !== "unknown" ? s.guildName : "Unknown Server";
            lines.push(`🎙 ${s.channelName} (${server}) — ${formatClock(winStart)} – ${formatClock(winEnd)} (${formatDuration(winMs)})${s.endedAt === null ? " • LIVE" : ""}`);
        }
        return lines.join("\n");
    };

    return (
        <div style={{ background: "var(--background-secondary)", border: "1px solid var(--background-modifier-accent)", padding: "14px", borderRadius: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "6px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    🌡 Activity Heatmap
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {!isCurrentWeek && (
                        <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => setWeekOffset(0)}>
                            Today
                        </Button>
                    )}
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => setWeekOffset(o => o + 1)}>◀</Button>
                    <span style={{ fontSize: "12px", color: "var(--header-primary)", fontWeight: "700", minWidth: "104px", textAlign: "center" }}>{weekLabel}</span>
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} disabled={isCurrentWeek} onClick={() => setWeekOffset(o => Math.max(0, o - 1))}>▶</Button>
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "46px repeat(24, 1fr)", gap: "2px" }}>
                <div />
                {[...Array(24)].map((_, h) => (
                    <div key={h} style={{ textAlign: "center", fontSize: "8px", color: "var(--text-muted)", fontWeight: "600" }}>{h % 6 === 0 ? h : ""}</div>
                ))}
            </div>
            {days.map((d, i) => {
                const prev = days[i - 1];
                const isNewMonth = !prev || prev.getMonth() !== d.getMonth();
                const isToday = d.getTime() === today.getTime();
                return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "46px repeat(24, 1fr)", gap: "2px", marginTop: "2px" }}>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", display: "flex", alignItems: "center", fontWeight: "600", gap: "3px", whiteSpace: "nowrap", overflow: "hidden" }}>
                            {isNewMonth && <span style={{ color: "var(--header-primary)", fontWeight: "800" }}>{MONTHS[d.getMonth()]}</span>}
                            <span>{DAYS[d.getDay()]}</span>
                            <span style={{ opacity: 0.8 }}>{d.getMonth() + 1}/{d.getDate()}</span>
                        </div>
                        {[...Array(24)].map((_, hour) => {
                            const count = heatmapData[`${dayKey(d)}-${hour}`] || 0;
                            const intensity = max > 0 ? count / max : 0;
                            const inChannels = sessionsInHour(d, hour);
                            const lines = inChannels.slice(0, 5);
                            return (
                                <div
                                    key={hour}
                                    onClick={() => setPinned(p => p && p.di === i && p.hour === hour ? null : { di: i, hour })}
                                    style={{
                                        position: "relative",
                                        background: count > 0 ? `rgba(88, 101, 242, ${0.15 + intensity * 0.85})` : "var(--background-tertiary)",
                                        aspectRatio: "1",
                                        borderRadius: "3px",
                                        cursor: "pointer",
                                        outline: pinned && pinned.di === i && pinned.hour === hour
                                            ? "2px solid var(--header-primary)"
                                            : (isToday ? "1px solid var(--text-normal)" : "none"),
                                        transition: "transform 0.1s ease"
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.transform = "scale(1.2)";
                                        const tt = hourTooltip(d, hour, count);
                                        const r = e.currentTarget.getBoundingClientRect();
                                        setHoverTip({ text: tt, x: r.left + r.width / 2, y: r.top - 8 });
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.transform = "scale(1)";
                                        setHoverTip(null);
                                    }}
                                >
                                    {lines.length > 0 && (() => {
                                        const hourStart = d.getTime() + hour * 3600e3;
                                        const hourEnd = hourStart + 3600e3;
                                        const fractions = lines.map(s => {
                                            const sEnd = s.endedAt ?? Date.now();
                                            return Math.min(1, Math.max(0, (Math.min(sEnd, hourEnd) - Math.max(s.startedAt, hourStart)) / 3600e3));
                                        });
                                        return (
                                            <div style={{ position: "absolute", left: 1, right: 1, bottom: 1, display: "flex", flexDirection: "column", gap: "1px" }}>
                                                {lines.map((s, li) => {
                                                    const frac = fractions[li];
                                                    const durMs = Math.round(frac * 3600e3);
                                                    const durStr = durMs >= 3600e3 ? "1h 0m" : durMs >= 60000 ? Math.floor(durMs / 60000) + "m" : durMs / 1000 + "s";
                                                    return (
                                                        <div key={li} title={`${s.channelName} — ${durStr}${s.endedAt === null ? " • LIVE" : ""}`} style={{
                                                            height: Math.max(1, 1 + frac * 4) + "px",
                                                            background: channelColor(s.channelName),
                                                            borderRadius: "1px",
                                                            opacity: s.endedAt === null ? 1 : (0.4 + frac * 0.6)
                                                        }} />
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
            {channels.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>▬ voice</span>
                    {channels.slice(0, 6).map(ch => (
                        <span key={ch} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "var(--text-muted)" }}>
                            <span style={{ width: "9px", height: "4px", borderRadius: "1px", background: channelColor(ch) }} />
                            {ch}
                        </span>
                    ))}
                    {channels.length > 6 && <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>+{channels.length - 6}</span>}
                </div>
            )}
            {pinned && (() => {
                const day = days[pinned.di];
                if (!day) return null;
                const hourStart = day.getTime() + pinned.hour * 3600e3;
                const hourEnd = hourStart + 3600e3;
                const windows = sessionsInHour(day, pinned.hour).map(s => {
                    const sEnd = s.endedAt ?? Date.now();
                    const winStart = Math.max(s.startedAt, hourStart);
                    const winEnd = Math.min(sEnd, hourEnd);
                    const server = s.guildName && s.guildName !== "unknown" ? s.guildName : "Unknown Server";
                    return {
                        channel: s.channelName,
                        server,
                        winStart,
                        winEnd,
                        winMs: Math.max(0, winEnd - winStart),
                        live: s.endedAt === null
                    };
                }).sort((a, b) => a.winStart - b.winStart);

                const header = `${DAYS[day.getDay()]} ${day.getMonth() + 1}/${day.getDate()} ${String(pinned.hour).padStart(2, "0")}:00`;
                const copyText = windows.length === 0
                    ? `${header} — no voice`
                    : windows.map(w => `${w.channel} (${w.server}) — ${formatClock(w.winStart)} – ${formatClock(w.winEnd)} (${formatDuration(w.winMs)})${w.live ? " • LIVE" : ""}`).join("\n");

                return (
                    <div style={{
                        marginTop: "10px", padding: "12px 14px", borderRadius: "10px",
                        background: "var(--background-tertiary)", border: "1px solid var(--background-modifier-accent)"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                            <div style={{ fontSize: "12px", color: "var(--header-primary)", fontWeight: "800" }}>
                                📌 {header}
                            </div>
                            <div style={{ display: "flex", gap: "6px" }}>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => {
                                    navigator.clipboard.writeText(copyText).catch(() => { });
                                }}>📋 Copy</Button>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.RED} onClick={() => setPinned(null)}>✕</Button>
                            </div>
                        </div>
                        {windows.length === 0 ? (
                            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>No voice activity in this hour.</div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                {windows.map((w, wi) => (
                                    <div key={wi} style={{
                                        display: "flex", alignItems: "center", gap: "8px", fontSize: "12px",
                                        background: "var(--background-secondary)", padding: "8px 10px", borderRadius: "8px"
                                    }}>
                                        <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: channelColor(w.channel), flexShrink: 0 }} />
                                        <strong style={{ color: "var(--header-primary)" }}>{w.channel}</strong>
                                        <span style={{ color: "var(--text-muted)" }}>{w.server}</span>
                                        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontWeight: "600" }}>
                                            {formatClock(w.winStart)} – {formatClock(w.winEnd)}
                                        </span>
                                        <span style={{ color: "var(--header-primary)", fontWeight: "700", minWidth: "48px", textAlign: "right" }}>
                                            {formatDuration(w.winMs)}{w.live && <span style={{ color: "#23A55A", marginLeft: "4px" }}>LIVE</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}
            {hoverTip && (
                <div style={{
                    position: "fixed", left: hoverTip.x, top: hoverTip.y, transform: "translate(-50%, -100%)",
                    background: "var(--background-floating)", border: "1px solid var(--background-modifier-accent)",
                    borderRadius: "8px", padding: "8px 10px", fontSize: "11px", color: "var(--header-primary)",
                    whiteSpace: "pre-line", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", zIndex: 9999, pointerEvents: "none",
                    maxWidth: "340px"
                }}>{hoverTip.text}</div>
            )}
        </div>
    );
}

interface VoiceSession {
    userId: string;
    username: string;
    startedAt: number;
    endedAt: number | null;
    durationMs: number;
    channelName: string;
    guildName?: string;
    channelId: string;
}

type TimelineEntry =
    | { kind: "log"; log: ActivityLog }
    | { kind: "session"; session: VoiceSession };

function pairVoiceSessions(userLogs: ActivityLog[]): TimelineEntry[] {
    const sorted = [...userLogs].sort((a, b) => a.timestamp - b.timestamp);
    const openSessions = new Map<string, { startedAt: number; username: string; channelName: string; guildName?: string; channelId: string }>();
    const entries: TimelineEntry[] = [];

    const closeSession = (userId: string, endedAt: number) => {
        const open = openSessions.get(userId);
        if (!open) return;
        openSessions.delete(userId);
        entries.push({
            kind: "session",
            session: {
                userId,
                username: open.username,
                startedAt: open.startedAt,
                endedAt,
                durationMs: endedAt - open.startedAt,
                channelName: open.channelName,
                guildName: open.guildName,
                channelId: open.channelId
            }
        });
    };

    for (const log of sorted) {
        if (log.type !== "voice" || !log.voiceChannel) {
            entries.push({ kind: "log", log });
            continue;
        }
        const vc = log.voiceChannel;
        if (vc.action === "join" || vc.action === "move") {
            closeSession(log.userId, log.timestamp);
            openSessions.set(log.userId, {
                startedAt: log.timestamp,
                username: log.username,
                channelName: vc.channelName,
                guildName: vc.guildName,
                channelId: vc.channelId
            });
        } else if (vc.action === "leave") {
            closeSession(log.userId, log.timestamp);
        }
    }

    // Any still-open session = user is in VC right now (or the leave event was missed)
    for (const [userId, open] of openSessions) {
        entries.push({
            kind: "session",
            session: {
                userId,
                username: open.username,
                startedAt: open.startedAt,
                endedAt: null,
                durationMs: Date.now() - open.startedAt,
                channelName: open.channelName,
                guildName: open.guildName,
                channelId: open.channelId
            }
        });
    }
    openSessions.clear();

    return entries.sort((a, b) => {
        const ta = a.kind === "log" ? a.log.timestamp : a.session.startedAt;
        const tb = b.kind === "log" ? b.log.timestamp : b.session.startedAt;
        return ta - tb;
    });
}

function formatDuration(ms: number): string {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

function VoiceSessionEntry({ session }: { session: VoiceSession }) {
    const ongoing = session.endedAt === null;
    return (
        <div style={{
            background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderLeft: `3px solid ${LOG_TYPE_CONFIG.voice.color}`,
            padding: "10px 12px",
            borderRadius: "10px",
            transition: "transform 0.1s ease, box-shadow 0.1s ease"
        }}
            onMouseEnter={e => {
                e.currentTarget.style.transform = "translateX(3px)";
                e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.35)";
            }}
            onMouseLeave={e => {
                e.currentTarget.style.transform = "translateX(0)";
                e.currentTarget.style.boxShadow = "none";
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ fontSize: "15px" }}>🎙</span>
                <strong style={{ color: "var(--header-primary)", fontSize: "13px" }}>{session.username}</strong>
                <span style={{ color: LOG_TYPE_CONFIG.voice.color, fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {ongoing ? "Live" : "Voice Session"}
                </span>
                <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)" }}>
                    {formatRelativeTime(session.startedAt)}
                </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", marginTop: "8px", background: LOG_TYPE_CONFIG.voice.bgColor, padding: "10px 12px", borderRadius: "8px" }}>
                {ongoing ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#23A55A", fontWeight: "700", fontSize: "12px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#23A55A", animation: "at-pulse 1.2s infinite" }} />
                        LIVE
                    </span>
                ) : (
                    <span style={{ fontWeight: "800", color: "var(--header-primary)" }}>{formatDuration(session.durationMs)}</span>
                )}
                <span style={{ color: "var(--text-normal)" }}>in “{session.channelName}”</span>
                {session.guildName && session.guildName !== "unknown" && (
                    <span style={{ color: "var(--text-muted)" }}>• {session.guildName}</span>
                )}
            </div>
            <style>{"@keyframes at-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }"}</style>
        </div>
    );
}

function LogEntry({ log }: { log: ActivityLog }) {
    const config = LOG_TYPE_CONFIG[log.type];
    const user = UserStore.getUser(log.userId);

    return (
        <div style={{
            background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderLeft: `3px solid ${config.color}`,
            padding: "10px 12px",
            borderRadius: "10px",
            transition: "transform 0.1s ease, box-shadow 0.1s ease"
        }}
            onMouseEnter={e => {
                e.currentTarget.style.transform = "translateX(3px)";
                e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.35)";
            }}
            onMouseLeave={e => {
                e.currentTarget.style.transform = "translateX(0)";
                e.currentTarget.style.boxShadow = "none";
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                {user && (
                    <img src={user.getAvatarURL(void 0, 32, true)}
                        style={{ width: "24px", height: "24px", borderRadius: "50%" }} alt="" />
                )}
                <span style={{ fontSize: "15px" }}>{config.icon}</span>
                <strong style={{ color: "var(--header-primary)", fontSize: "13px" }}>{log.username}</strong>
                <span style={{ color: config.color, fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>{config.label}</span>
                <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)" }}>{formatRelativeTime(log.timestamp)}</span>
            </div>
            {log.type === "activity" && log.activities && (
                <div style={{ fontSize: "13px", marginTop: "8px", background: config.bgColor, padding: "10px 12px", borderRadius: "8px" }}>
                    {log.activities.map((a, i) => (
                        <div key={i} style={{ marginBottom: i < log.activities!.length - 1 ? "6px" : 0 }}>
                            <span style={{ fontSize: "15px" }}>{a.type === 2 ? "🎧" : a.type === 1 ? "🎮" : a.type === 3 ? "📺" : "✨"}</span>{" "}
                            <strong style={{ color: "var(--header-primary)" }}>{a.name}</strong>
                            {a.details && <span style={{ color: "var(--text-muted)" }}> — {a.details}</span>}
                            {a.state && <div style={{ color: "var(--text-muted)", marginTop: "2px" }}>{a.state}</div>}
                        </div>
                    ))}
                </div>
            )}
            {log.type === "voice" && log.voiceChannel && (
                <div style={{ fontSize: "13px", marginTop: "8px", background: config.bgColor, padding: "10px 12px", borderRadius: "8px" }}>
                    <span style={{ fontSize: "15px" }}>{log.voiceChannel.action === "join" ? "🔊" : log.voiceChannel.action === "leave" ? "🔇" : "🔄"}</span>{" "}
                    <strong style={{ color: config.color }}>{log.voiceChannel.action.toUpperCase()}</strong>{" "}
                    <span style={{ color: "var(--text-normal)" }}>{log.voiceChannel.channelName}</span>
                    {log.voiceChannel.guildName && <span style={{ color: "var(--text-muted)" }}> • {log.voiceChannel.guildName}</span>}
                </div>
            )}
            {log.type === "message" && log.message && (
                <div style={{ fontSize: "13px", marginTop: "8px", background: config.bgColor, padding: "10px 12px", borderRadius: "8px" }}>
                    <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>
                        {log.message.channelName || "Unknown channel"}{log.message.guildName ? ` • ${log.message.guildName}` : ""}
                    </div>
                    <div style={{ color: "var(--text-normal)" }}>“{log.message.content}”</div>
                </div>
            )}
            {log.type === "status" && log.status && (
                <div style={{ fontSize: "13px", marginTop: "8px", background: config.bgColor, padding: "10px 12px", borderRadius: "8px" }}>
                    <span style={{ fontSize: "15px" }}>{log.status.status === "online" ? "🟢" : log.status.status === "idle" ? "🌙" : log.status.status === "dnd" ? "🔴" : "⚪"}</span>{" "}
                    Status changed to <strong style={{ color: config.color }}>{log.status.status.toUpperCase()}</strong>
                </div>
            )}
        </div>
    );
}

function channelColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 65% 60%)`;
}

function formatClock(ts: number): string {
    const d = new Date(ts);
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m} ${ampm}`;
}

function VoiceTimeByServer({ sessions }: { sessions: VoiceSession[] }) {
    const byServer = React.useMemo(() => {
        const servers = new Map<string, Map<string, number>>();
        for (const s of sessions) {
            const server = s.guildName && s.guildName !== "unknown" ? s.guildName : "Unknown Server";
            if (!servers.has(server)) servers.set(server, new Map());
            const channels = servers.get(server)!;
            channels.set(s.channelName, (channels.get(s.channelName) || 0) + s.durationMs);
        }
        return [...servers.entries()].map(([server, chans]) => ({
            server,
            totalMs: [...chans.values()].reduce((a, b) => a + b, 0),
            channels: [...chans.entries()]
                .map(([name, ms]) => ({ name, ms }))
                .sort((a, b) => b.ms - a.ms)
        })).sort((a, b) => b.totalMs - a.totalMs);
    }, [sessions]);

    if (byServer.length === 0) return null;
    const max = byServer[0].totalMs;

    return (
        <div style={{ background: "var(--background-secondary)", border: "1px solid var(--background-modifier-accent)", padding: "14px", borderRadius: "12px" }}>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                🎙 Voice Time by Server
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {byServer.map(s => (
                    <div key={s.server}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ width: "130px", fontSize: "12px", color: "var(--text-normal)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: "700" }}>{s.server}</div>
                            <div style={{ flex: 1, background: "var(--background-tertiary)", borderRadius: "4px", height: "16px", overflow: "hidden" }}>
                                <div style={{
                                    width: `${max > 0 ? (s.totalMs / max) * 100 : 0}%`,
                                    height: "100%",
                                    background: "linear-gradient(90deg, #5865F2, #7983F5)",
                                    borderRadius: "4px",
                                    minWidth: s.totalMs > 0 ? "6px" : 0
                                }} />
                            </div>
                            <div style={{ width: "62px", fontSize: "12px", color: "var(--header-primary)", fontWeight: "700", textAlign: "right" }}>{formatDuration(s.totalMs)}</div>
                        </div>
                        {s.channels.length > 0 && (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "5px 0 0 138px" }}>
                                {s.channels.slice(0, 6).map(ch => (
                                    <span key={ch.name} title={`${ch.name} — ${formatDuration(ch.ms)}`}
                                        style={{
                                            display: "inline-flex", alignItems: "center", gap: "4px",
                                            fontSize: "10px", color: "var(--text-muted)",
                                            background: "var(--background-tertiary)", padding: "2px 8px", borderRadius: "999px",
                                            border: `1px solid ${channelColor(ch.name)}40`
                                        }}>
                                        <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: channelColor(ch.name) }} />
                                        {ch.name} · {formatDuration(ch.ms)}
                                    </span>
                                ))}
                                {s.channels.length > 6 && (
                                    <span style={{ fontSize: "10px", color: "var(--text-muted)", padding: "2px 4px" }}>+{s.channels.length - 6} more</span>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function UserProfile({ userId, logs, onClose }: { userId: string; logs: ActivityLog[]; onClose: () => void }) {
    const userLogs = React.useMemo(() => logs.filter(l => l.userId === userId), [logs, userId]);
    const user = UserStore.getUser(userId);
    const isTracked = trackedUserIds.has(userId);

    const [presence, setPresence] = React.useState<{ status: string; activities: any[] }>({ status: "offline", activities: [] });
    React.useEffect(() => {
        const update = () => {
            setPresence({
                status: PresenceStore.getStatus(userId) || "offline",
                activities: (PresenceStore.getActivities(userId) || []) as any[]
            });
        };
        update();
        FluxDispatcher.subscribe("PRESENCE_UPDATES", update);
        return () => FluxDispatcher.unsubscribe("PRESENCE_UPDATES", update);
    }, [userId]);

    const [typeFilter, setTypeFilter] = React.useState<"all" | ActivityLog["type"]>("all");
    const stats = React.useMemo(() => calculateStats(userLogs), [userLogs]);
    const voiceSessions = React.useMemo(
        () => pairVoiceSessions(userLogs).filter(e => e.kind === "session").map(e => e.session),
        [userLogs]
    );

    const visibleLogs = React.useMemo(() => {
        const paired = pairVoiceSessions(userLogs);
        const filtered = typeFilter === "all"
            ? paired
            : paired.filter(e => {
                if (typeFilter === "voice") return e.kind === "session";
                return e.kind === "log" && e.log.type === typeFilter;
            });
        return filtered.slice(-50).reverse();
    }, [userLogs, typeFilter]);

    const statusColor = presence.status === "online" ? "#23A55A" : presence.status === "idle" ? "#F0B232" : presence.status === "dnd" ? "#F23F43" : "#80848E";
    const statusIcon = presence.status === "online" ? "🟢" : presence.status === "idle" ? "🌙" : presence.status === "dnd" ? "🔴" : "⚪";
    const mainActivity = presence.activities.find(a => a.type !== 4) || presence.activities[0];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Profile card */}
            <div style={{
                display: "flex", alignItems: "center", gap: "14px",
                background: "linear-gradient(135deg, #5865F212 0%, #5865F204 100%)",
                border: "1px solid #5865F228", borderRadius: "14px", padding: "14px 16px"
            }}>
                <div style={{ position: "relative" }}>
                    <UserAvatar userId={userId} name={userLogs[0]?.username} size={60} />
                    <div style={{
                        position: "absolute", bottom: 2, right: 2, width: "17px", height: "17px", borderRadius: "50%",
                        background: statusColor, border: "3px solid var(--background-secondary)"
                    }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "17px", fontWeight: "800", color: "var(--header-primary)" }}>{user?.globalName || user?.username || userLogs[0]?.username || "Unknown user"}</span>
                        {isTracked && (
                            <span style={{
                                fontSize: "10px", fontWeight: "700", padding: "2px 8px", borderRadius: "999px",
                                background: "#23A55A20", color: "#23A55A", border: "1px solid #23A55A40"
                            }}>TRACKING</span>
                        )}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                        {user?.username ? `@${user.username}` : userLogs[0]?.username ? `@${userLogs[0].username}` : ""} <span style={{ fontFamily: "monospace", fontSize: "11px" }}>• {userId}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px" }}>
                        <span style={{ fontSize: "13px" }}>{statusIcon}</span>
                        <span style={{ fontSize: "13px", fontWeight: "600", color: statusColor, textTransform: "capitalize" }}>
                            {presence.status === "dnd" ? "Do Not Disturb" : presence.status}
                        </span>
                        {mainActivity && (
                            <span style={{ fontSize: "12px", color: "var(--text-normal)", marginLeft: "2px" }}>
                                — {mainActivity.name}{mainActivity.details ? `: ${mainActivity.details}` : ""}
                            </span>
                        )}
                    </div>
                </div>
                <Button size={Button.Sizes.SMALL} color={isTracked ? Button.Colors.RED : Button.Colors.GREEN}
                    onClick={() => {
                        if (isTracked) trackedUserIds.delete(userId);
                        else trackedUserIds.add(userId);
                        saveToSettings();
                    }}>
                    {isTracked ? "⏹ Stop" : "▶ Track"}
                </Button>
            </div>

            {/* Stat strip */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <StatTile label="Messages" value={stats.messageCount} color="#FEE75C" icon="💬" />
                <StatTile label="Activities" value={stats.activityCount} color="#5865F2" icon="🎮" />
                <StatTile label="Voice" value={stats.voiceCount} color="#57F287" icon="🔊" />
                <StatTile label="Status" value={stats.statusCount} color="#EB459E" icon="🟢" />
                <StatTile label="Voice Time" value={`${Math.floor(stats.totalVoiceMinutes / 60)}h ${stats.totalVoiceMinutes % 60}m`} color="#F0B232" icon="🎙" />
            </div>

            {/* Voice totals */}
            {voiceSessions.length > 0 && <VoiceTimeByServer sessions={voiceSessions} />}

            {/* Heatmap (activity intensity + voice thin lines) */}
            <WeekHeatmap heatmapData={stats.heatmapData} sessions={voiceSessions} />

            {/* Timeline */}
            <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        📜 Timeline ({visibleLogs.length})
                    </span>
                    <div style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
                        {TYPE_FILTERS.map(f => (
                            <Button key={f.id} size={Button.Sizes.MIN} color={typeFilter === f.id ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                                onClick={() => setTypeFilter(f.id)}>
                                {f.icon} {f.label}
                            </Button>
                        ))}
                    </div>
                </div>
                {visibleLogs.length === 0 ? (
                    <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                        No activity recorded for this user yet
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {visibleLogs.map((entry, idx) =>
                            entry.kind === "session"
                                ? <VoiceSessionEntry key={idx} session={entry.session} />
                                : <LogEntry key={idx} log={entry.log} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function ActivityDashboard({ logs, modalProps }: { logs: ActivityLog[], modalProps: any }) {
    const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
    const [search, setSearch] = React.useState("");

    // Live refresh: re-snapshot logs + re-render sidebar presence every 2s
    const [tick, setTick] = React.useState(0);
    React.useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 2000);
        return () => clearInterval(id);
    }, []);
    const liveLogs = React.useMemo(() => logs.slice(), [tick]);

    const uniqueUsers = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const log of liveLogs) {
            if (!map.has(log.userId)) map.set(log.userId, log.username);
        }
        for (const id of trackedUserIds) {
            if (!map.has(id)) {
                const u = UserStore.getUser(id);
                map.set(id, u?.username || id);
            }
        }
        return Array.from(map, ([id, username]) => ({ id, username }));
    }, [liveLogs]);

    const trackedUsers = uniqueUsers.filter(u => trackedUserIds.has(u.id));
    const recentUsers = uniqueUsers.filter(u => !trackedUserIds.has(u.id));

    const q = search.trim().toLowerCase();
    const filteredTracked = trackedUsers.filter(u => !q || u.username.toLowerCase().includes(q) || u.id === q);
    const filteredRecent = recentUsers.filter(u => !q || u.username.toLowerCase().includes(q) || u.id === q);

    const selectedUser = selectedUserId ? uniqueUsers.find(u => u.id === selectedUserId) : null;

    const clearAll = () => {
        activityLogs.length = 0;
        trackedUserIds.clear();
        lastKnownStatus.clear();
        lastKnownActivities.clear();
        saveToSettings();
        setSelectedUserId(null);
    };

    const header = (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingRight: "40px", paddingBottom: "12px", borderBottom: "1px solid var(--background-modifier-accent)" }}>
            <div>
                <Forms.FormTitle tag="h2" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                    <ActivityLogo size={26} /> Activity Tracker
                </Forms.FormTitle>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px", fontWeight: "500" }}>
                    {logs.length} total logs • {trackedUserIds.size} tracked users
                </div>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => exportJSON(logs)}>⬇ Export</Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={clearAll}>🗑 Clear all</Button>
            </div>
        </div>
    );

    const SidebarRow = ({ userId, username, tracked }: { userId: string; username: string; tracked: boolean }) => {
        const [presence, setPresence] = React.useState("offline");
        React.useEffect(() => {
            const update = () => setPresence(PresenceStore.getStatus(userId) || "offline");
            update();
            FluxDispatcher.subscribe("PRESENCE_UPDATES", update);
            return () => FluxDispatcher.unsubscribe("PRESENCE_UPDATES", update);
        }, [userId]);

        const dotColor = presence === "online" ? "#23A55A" : presence === "idle" ? "#F0B232" : presence === "dnd" ? "#F23F43" : "#80848E";
        const dotIcon = presence === "online" ? "🟢" : presence === "idle" ? "🌙" : presence === "dnd" ? "🔴" : "⚪";
        const user = UserStore.getUser(userId);
        const isSelected = selectedUserId === userId;

        return (
            <div
                onClick={() => setSelectedUserId(userId)}
                style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px",
                    background: isSelected ? "var(--brand-experiment-500)22" : tracked ? "#23A55A10" : "transparent",
                    border: `1px solid ${isSelected ? "var(--brand-experiment-500)55" : "transparent"}`,
                    cursor: "pointer", transition: "background 0.1s ease"
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--background-modifier-hover)"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = tracked ? "#23A55A10" : "transparent"; }}
            >
                <div style={{ position: "relative" }}>
                    <UserAvatar userId={userId} name={username} size={28} />
                    <span style={{ position: "absolute", bottom: -1, right: -1, fontSize: "11px", lineHeight: 1 }}>{dotIcon}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: isSelected ? "700" : "600", color: "var(--header-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {username}
                    </div>
                </div>
                {tracked && <span style={{ fontSize: "10px", color: "#23A55A" }}>✓</span>}
            </div>
        );
    };

    return (
        <Modal {...modalProps} size="dynamic" title={header}
            footer={<Button color={Button.Colors.BRAND} onClick={modalProps.onClose}>Close</Button>}>
            <div style={{ display: "flex", height: "600px", background: "var(--background-primary)" }}>
                {/* Left sidebar */}
                <div style={{
                    width: "220px", minWidth: "220px", borderRight: "1px solid var(--background-modifier-accent)",
                    display: "flex", flexDirection: "column"
                }}>
                    <div style={{ padding: "12px", borderBottom: "1px solid var(--background-modifier-accent)" }}>
                        <TextInput placeholder="🔍 Search users..." value={search} onChange={setSearch} />
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
                        {trackedUsers.length > 0 && (
                            <>
                                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", margin: "4px 4px 8px" }}>
                                    Tracked ({trackedUsers.length})
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }}>
                                    {filteredTracked.map(u => <SidebarRow key={u.id} userId={u.id} username={u.username} tracked />)}
                                    {q && filteredTracked.length === 0 && <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 4px" }}>No tracked users match</div>}
                                </div>
                            </>
                        )}
                        {recentUsers.length > 0 && (
                            <>
                                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", margin: "4px 4px 8px" }}>
                                    Recent ({recentUsers.length})
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {filteredRecent.map(u => <SidebarRow key={u.id} userId={u.id} username={u.username} tracked={false} />)}
                                    {q && filteredRecent.length === 0 && <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 4px" }}>No recent users match</div>}
                                </div>
                            </>
                        )}
                        {uniqueUsers.length === 0 && (
                            <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                                No users yet.<br />Right-click someone to start tracking.
                            </div>
                        )}
                    </div>
                </div>

                {/* Right panel */}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
                    {selectedUser ? (
                        <UserProfile userId={selectedUser.id} logs={liveLogs} onClose={modalProps.onClose} />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", textAlign: "center" }}>
                            <div style={{ fontSize: "56px", marginBottom: "14px" }}>👤</div>
                            <div style={{ fontSize: "18px", fontWeight: "700", marginBottom: "6px", color: "var(--header-primary)" }}>Select a user</div>
                            <div style={{ fontSize: "13px" }}>Pick someone from the list to see their full activity profile</div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}


const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props?.user) return;

    const userId = props.user.id;
    const isTracked = trackedUserIds.has(userId);

    children.push(
        <Menu.MenuItem
            id="activity-tracker-dashboard"
            label="Activity Tracker"
            action={() => {
                console.log("[ActivityTracker] Opening dashboard for user:", userId);
                try {
                    openModal(modalProps => {
                        return (
                            <ActivityDashboard logs={activityLogs} modalProps={modalProps} />
                        );
                    });
                } catch (e) {
                    console.error("[ActivityTracker] Error opening modal:", e);
                }
            }}
        />,
        <Menu.MenuItem
            id="activity-tracker-toggle"
            label={isTracked ? "Stop Tracking User" : "Start Tracking User"}
            action={() => {
                console.log("[ActivityTracker] Toggle tracking for user:", userId, "Currently tracked:", isTracked);
                if (isTracked) {
                    trackedUserIds.delete(userId);
                    console.log("[ActivityTracker] Removed user from tracking");
                } else {
                    trackedUserIds.add(userId);
                    console.log("[ActivityTracker] Added user to tracking. Total tracked:", trackedUserIds.size);
                }
                saveToSettings();
                console.log("[ActivityTracker] Tracked users:", Array.from(trackedUserIds));
            }}
        />
    );
};

export default definePlugin({
    name: "ActivityTracker",
    description: "Track and log Discord user activities with dashboard",
    authors: [{ name: "Elioflex", id: 0n }],
    settings,

    start() {
        loadFromSettings();
        FluxDispatcher.subscribe("PRESENCE_UPDATES", this.handlePresenceUpdates);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.handleMessageCreate);
        addContextMenuPatch("user-context", UserContextMenuPatch);
        console.log("[ActivityTracker] Plugin started, listening to events");
    },

    stop() {
        flushSave();
        FluxDispatcher.unsubscribe("PRESENCE_UPDATES", this.handlePresenceUpdates);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.handleMessageCreate);
        removeContextMenuPatch("user-context", UserContextMenuPatch);
    },

    handlePresenceUpdates(data: { updates: any[] }) {
        if (!data?.updates) return;

        for (const update of data.updates) {
            if (!update?.user?.id) continue;

            const shouldTrack = trackedUserIds.has(update.user.id);
            if (!shouldTrack) continue;

            const user = UserStore.getUser(update.user.id);
            if (!user) continue;

            const currentStatus = update.status;
            const previousStatus = lastKnownStatus.get(user.id);

            console.log("[ActivityTracker] PRESENCE_UPDATES:", {
                userId: user.id,
                username: user.username,
                currentStatus,
                previousStatus,
                clientStatus: update.clientStatus,
                activities: update.activities
            });

            // Log status changes only if status actually changed
            if (currentStatus && currentStatus !== previousStatus && update.clientStatus) {
                lastKnownStatus.set(user.id, currentStatus);

                const log: ActivityLog = {
                    userId: user.id,
                    username: `${user.username}`,
                    timestamp: Date.now(),
                    type: "status",
                    status: {
                        status: currentStatus,
                        clientStatus: update.clientStatus
                    }
                };
                activityLogs.push(log);
                scheduleSave();
                console.log(`[ActivityTracker] ${log.username} status changed: ${previousStatus || "none"} -> ${currentStatus}`);

                if (settings.store.notifyStatus && previousStatus) {
                    const name = user.globalName || user.username;
                    const timestamp = new Date();
                    const timeStr = timestamp.toLocaleTimeString();
                    const dateStr = timestamp.toLocaleDateString();
                    showNotification({
                        title: shouldBeNative() ? `${name} changed status` : "User status change",
                        body: `${name} is now ${currentStatus}\n${dateStr} at ${timeStr}`,
                        noPersist: !settings.store.persistNotifications,
                        richBody: getRichBody(user,
                            <div>
                                <div style={{ fontWeight: "bold" }}>{name}'s status is now {currentStatus}</div>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>{dateStr} at {timeStr}</div>
                            </div>
                        )
                    });
                }
            }

            // Log activities only when they actually change. Discord sends
            // frequent presence heartbeats with identical activity payloads;
            // without this, every heartbeat would write a duplicate log entry.
            const activities = update.activities || [];
            const activitySignature = activities
                .map(a => `${a.type}:${a.name ?? ""}:${a.state ?? ""}:${a.details ?? ""}:${a.timestamps?.start ?? ""}:${a.timestamps?.end ?? ""}:${a.application_id ?? ""}`)
                .join("|");
            if (activitySignature && activitySignature !== lastKnownActivities.get(user.id)) {
                lastKnownActivities.set(user.id, activitySignature);
                const log: ActivityLog = {
                    userId: user.id,
                    username: `${user.username}`,
                    timestamp: Date.now(),
                    type: "activity",
                    activities: activities
                };
                activityLogs.push(log);
                scheduleSave();
                console.log(`[ActivityTracker] ${log.username} activity:`, activities);
            }

            if (activityLogs.length > MAX_LOGS) {
                activityLogs.shift();
            }
        }
    },

    handleVoiceStateUpdate(data: any) {
        const { voiceStates } = data;
        if (!voiceStates) return;

        voiceStates.forEach((state: any) => {
            const shouldTrack = trackedUserIds.has(state.userId);
            if (!shouldTrack) return;

            const user = UserStore.getUser(state.userId);
            if (!user) return;

            // Get previous state to track channel leaving
            const prevChannelId = state.oldChannelId || null;
            const currentChannelId = state.channelId || null;

            const channel = ChannelStore.getChannel(currentChannelId || prevChannelId);
            const guild = GuildStore.getGuild(state.guildId);

            const action = !prevChannelId && currentChannelId ? "join" :
                          prevChannelId && !currentChannelId ? "leave" :
                          "move";

            console.log("[ActivityTracker] Channel lookup:", {
                channelId: currentChannelId || prevChannelId,
                channel: channel,
                channelName: channel?.name,
                guildId: state.guildId,
                guild: guild,
                guildName: guild?.name
            });

            const log: ActivityLog = {
                userId: user.id,
                username: `${user.username}`,
                timestamp: Date.now(),
                type: "voice",
                voiceChannel: {
                    channelId: currentChannelId || prevChannelId || "unknown",
                    channelName: channel?.name || `Channel ID: ${currentChannelId || prevChannelId}`,
                    action: action,
                    guildId: state.guildId || "unknown",
                    guildName: guild?.name || `Server ID: ${state.guildId}`
                }
            };

            activityLogs.push(log);
            if (activityLogs.length > MAX_LOGS) activityLogs.shift();
            scheduleSave();

            console.log(`[ActivityTracker] ${log.username} voice:`, log.voiceChannel, "Raw state:", state);

            if (settings.store.notifyVoice && currentChannelId !== prevChannelId) {
                const name = user.username;
                const channelName = channel?.name || "Unknown Channel";
                const guildName = guild?.name || "Unknown Server";
                const timestamp = new Date();
                const timeStr = timestamp.toLocaleTimeString();
                const dateStr = timestamp.toLocaleDateString();
                const title = shouldBeNative() ? `User ${name} changed voice status` : "User voice status change";
                if (currentChannelId) {
                    showNotification({
                        title,
                        body: `${name} joined "${channelName}" in ${guildName}\n${dateStr} at ${timeStr}`,
                        noPersist: !settings.store.persistNotifications,
                        richBody: getRichBody(user,
                            <div>
                                <div style={{ fontWeight: "bold" }}>{name} joined voice channel</div>
                                <div>📢 {channelName}</div>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>in {guildName}</div>
                                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>{dateStr} at {timeStr}</div>
                            </div>
                        )
                    });
                } else {
                    showNotification({
                        title,
                        body: `${name} left "${channelName}" in ${guildName}\n${dateStr} at ${timeStr}`,
                        noPersist: !settings.store.persistNotifications,
                        richBody: getRichBody(user,
                            <div>
                                <div style={{ fontWeight: "bold" }}>{name} left voice channel</div>
                                <div>📢 {channelName}</div>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>in {guildName}</div>
                                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>{dateStr} at {timeStr}</div>
                            </div>
                        )
                    });
                }
            }
        });
    },

    handleMessageCreate(data: any) {
        const { message } = data;
        if (!message?.author?.id) return;

        const shouldTrack = trackedUserIds.has(message.author.id);
        if (!shouldTrack) return;

        // Prevent duplicate messages
        if (message.id && processedMessageIds.has(message.id)) return;
        if (message.id) processedMessageIds.add(message.id);

        const channel = ChannelStore.getChannel(message.channel_id);
        const guild = message.guild_id ? GuildStore.getGuild(message.guild_id) : null;

        const log: ActivityLog = {
            userId: message.author.id,
            username: `${message.author.username}`,
            timestamp: Date.now(),
            type: "message",
            message: {
                content: message.content.length > MAX_MESSAGE_CONTENT
                    ? message.content.slice(0, MAX_MESSAGE_CONTENT) + "…"
                    : message.content,
                channelId: message.channel_id,
                channelName: channel?.name || `Channel ID: ${message.channel_id}`,
                guildId: message.guild_id,
                guildName: guild?.name || (message.guild_id ? `Server ID: ${message.guild_id}` : "DM")
            }
        };

        activityLogs.push(log);
        if (activityLogs.length > MAX_LOGS) activityLogs.shift();
        scheduleSave();

        // Clean up old message IDs (keep last 1000)
        if (processedMessageIds.size > 1000) {
            const idsArray = Array.from(processedMessageIds);
            processedMessageIds.clear();
            idsArray.slice(-500).forEach(id => processedMessageIds.add(id));
        }

        console.log(`[ActivityTracker] ${log.username} message:`, message.content?.substring(0, 50));
    },

    openDashboard() {
        openModal(modalProps => (
            <ActivityDashboard logs={activityLogs} modalProps={modalProps} />
        ));
    },

    trackUser(userId: string) {
        trackedUserIds.add(userId);
        console.log(`[ActivityTracker] Now tracking user: ${userId}`);
    },

    untrackUser(userId: string) {
        trackedUserIds.delete(userId);
        console.log(`[ActivityTracker] Stopped tracking user: ${userId}`);
    },

    getTrackedUsers() {
        return Array.from(trackedUserIds);
    },

    getActivityLogs(userId?: string) {
        if (userId) {
            return activityLogs.filter(log => log.userId === userId);
        }
        return activityLogs;
    },

    clearLogs() {
        activityLogs.length = 0;
        scheduleSave();
    },

    exportLogs() {
        return JSON.stringify(activityLogs, null, 2);
    }
});
