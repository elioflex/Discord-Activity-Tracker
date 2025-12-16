/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { definePluginSettings, Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore, React, Menu, Forms, TextInput, ChannelStore, GuildStore, PresenceStore } from "@webpack/common";
import { ModalRoot, ModalHeader, ModalContent, ModalFooter, openModal } from "@utils/modal";
import { Button } from "@webpack/common";
import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import type { User } from "discord-types/general";

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
let trackedUserIds = new Set<string>();
const processedMessageIds = new Set<string>();
const lastKnownStatus = new Map<string, string>();

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
        console.log('[ActivityTracker] Loaded from storage:', activityLogs.length, 'logs,', trackedUserIds.size, 'tracked users');
    } catch (e) {
        console.error('[ActivityTracker] Failed to load data:', e);
    }
}

// Save data to settings
function saveToSettings() {
    try {
        settings.store.trackedUsers = JSON.stringify(Array.from(trackedUserIds));
        settings.store.activityLogs = JSON.stringify(activityLogs);
    } catch (e) {
        console.error('[ActivityTracker] Failed to save data:', e);
    }
}

const settings = definePluginSettings({
    autoTrackAll: {
        type: OptionType.BOOLEAN,
        description: "Automatically track all users",
        default: false
    },
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
    }
});

function ActivityDashboard({ logs, modalProps }: { logs: ActivityLog[], modalProps: any }) {
    const [searchUser, setSearchUser] = React.useState("");
    const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
    const [showStats, setShowStats] = React.useState(false);
    const [statsUserId, setStatsUserId] = React.useState<string | null>(null);

    console.log('[ActivityTracker] Rendering dashboard, logs:', logs.length, 'modalProps:', modalProps);

    const filteredLogs = searchUser
        ? logs.filter(log => log.username.toLowerCase().includes(searchUser.toLowerCase()) || log.userId === searchUser)
        : logs;

    const userLogs = selectedUserId
        ? filteredLogs.filter(log => log.userId === selectedUserId)
        : filteredLogs;

    const uniqueUsers = Array.from(new Set(logs.map(log => log.userId)))
        .map(id => {
            const log = logs.find(l => l.userId === id);
            return { id, username: log?.username || "Unknown" };
        });

    // Calculate statistics for selected user or all
    const calculateStats = (userId: string | null) => {
        const userSpecificLogs = userId ? logs.filter(l => l.userId === userId) : logs;
        
        // Message count
        const messageCount = userSpecificLogs.filter(l => l.type === "message").length;
        
        // Activity count by type
        const activityCount = userSpecificLogs.filter(l => l.type === "activity").length;
        const voiceCount = userSpecificLogs.filter(l => l.type === "voice").length;
        const statusCount = userSpecificLogs.filter(l => l.type === "status").length;
        
        // Most active hours (0-23)
        const hourCounts: { [hour: number]: number } = {};
        for (let i = 0; i < 24; i++) hourCounts[i] = 0;
        
        userSpecificLogs.forEach(log => {
            const hour = new Date(log.timestamp).getHours();
            hourCounts[hour]++;
        });
        
        const mostActiveHour = Object.entries(hourCounts)
            .sort(([, a], [, b]) => b - a)[0];
        
        // Voice time tracking (approximate based on join/leave events)
        const voiceLogs = userSpecificLogs.filter(l => l.type === "voice");
        let totalVoiceMinutes = 0;
        let lastJoinTime: number | null = null;
        
        voiceLogs.forEach(log => {
            if (log.voiceChannel?.action === "join") {
                lastJoinTime = log.timestamp;
            } else if (log.voiceChannel?.action === "leave" && lastJoinTime) {
                totalVoiceMinutes += (log.timestamp - lastJoinTime) / (1000 * 60);
                lastJoinTime = null;
            }
        });
        
        // Activity heatmap data (day of week + hour)
        const heatmapData: { [key: string]: number } = {};
        userSpecificLogs.forEach(log => {
            const date = new Date(log.timestamp);
            const day = date.getDay(); // 0-6
            const hour = date.getHours(); // 0-23
            const key = `${day}-${hour}`;
            heatmapData[key] = (heatmapData[key] || 0) + 1;
        });
        
        return {
            messageCount,
            activityCount,
            voiceCount,
            statusCount,
            totalLogs: userSpecificLogs.length,
            mostActiveHour: mostActiveHour ? `${mostActiveHour[0]}:00 (${mostActiveHour[1]} events)` : "N/A",
            hourCounts,
            totalVoiceMinutes: Math.round(totalVoiceMinutes),
            heatmapData
        };
    };

    const stats = calculateStats(statsUserId);

    return (
        <ModalRoot transitionState={modalProps.transitionState}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingRight: "40px" }}>
                    <div>
                        <Forms.FormTitle tag="h2" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                            📊 Activity Tracker
                        </Forms.FormTitle>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                            {logs.length} total logs • {trackedUserIds.size} tracked users
                        </div>
                    </div>
                </div>
            </ModalHeader>
            <ModalContent style={{ padding: "20px", maxHeight: "700px", overflow: "auto", background: "var(--background-primary)" }}>
                {/* Action Buttons Card */}
                <div style={{ 
                    background: "var(--background-secondary)",
                    padding: "16px",
                    borderRadius: "12px",
                    marginBottom: "20px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
                }}>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px", textTransform: "uppercase", fontWeight: "600" }}>Actions</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <Button
                            color={Button.Colors.BRAND}
                            size={Button.Sizes.SMALL}
                            onClick={() => {
                                const json = JSON.stringify(activityLogs, null, 2);
                                const blob = new Blob([json], { type: "application/json" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `activity-logs-${Date.now()}.json`;
                                a.click();
                                URL.revokeObjectURL(url);
                            }}
                        >
                            📥 Export JSON
                        </Button>
                        <Button
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            onClick={() => {
                                let text = "Activity Tracker Logs\n" + "=".repeat(50) + "\n\n";
                                activityLogs.forEach(log => {
                                    text += `${log.username} - ${log.type} - ${new Date(log.timestamp).toLocaleString()}\n`;
                                    if (log.type === "activity" && log.activities) {
                                        log.activities.forEach(act => {
                                            text += `  • ${act.name}${act.details ? ` - ${act.details}` : ""}\n`;
                                        });
                                    } else if (log.type === "voice" && log.voiceChannel) {
                                        text += `  ${log.username} has ${log.voiceChannel.action}ed the voice channel "${log.voiceChannel.channelName}", in the server "${log.voiceChannel.guildName || "Unknown Server"}" at ${new Date(log.timestamp).toLocaleTimeString()}\n`;
                                    } else if (log.type === "message" && log.message) {
                                        text += `  ${log.message.content}\n`;
                                    } else if (log.type === "status" && log.status) {
                                        text += `  Status: ${log.status.status}\n`;
                                    }
                                    text += "\n";
                                });
                                const blob = new Blob([text], { type: "text/plain" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `activity-logs-${Date.now()}.txt`;
                                a.click();
                                URL.revokeObjectURL(url);
                            }}
                        >
                            📄 Export TXT
                        </Button>
                        <Button
                            color={Button.Colors.RED}
                            size={Button.Sizes.SMALL}
                            onClick={() => {
                                activityLogs.length = 0;
                                trackedUserIds.clear();
                                modalProps.onClose();
                            }}
                        >
                            🗑️ Clear All
                        </Button>
                    </div>
                </div>

                {/* Statistics Card */}
                <div style={{ 
                    background: "var(--background-secondary)",
                    padding: "16px",
                    borderRadius: "12px",
                    marginBottom: "20px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>
                            📊 Statistics {statsUserId && `- ${uniqueUsers.find(u => u.id === statsUserId)?.username}`}
                        </div>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={showStats ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                            onClick={() => setShowStats(!showStats)}
                        >
                            {showStats ? "Hide" : "Show"}
                        </Button>
                    </div>
                    
                    {showStats && (
                        <div>
                            {/* User Selection */}
                            <div style={{ marginBottom: "16px" }}>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>Select User</div>
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                    {uniqueUsers.map(user => (
                                        <Button
                                            key={user.id}
                                            size={Button.Sizes.SMALL}
                                            color={statsUserId === user.id ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                                            onClick={() => setStatsUserId(statsUserId === user.id ? null : user.id)}
                                        >
                                            {user.username}
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            {statsUserId ? (
                                <div>
                            {/* Overview Stats */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                                <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#FEE75C" }}>{stats.messageCount}</div>
                                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>Messages</div>
                                </div>
                                <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#5865F2" }}>{stats.activityCount}</div>
                                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>Activities</div>
                                </div>
                                <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#57F287" }}>{stats.voiceCount}</div>
                                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>Voice Events</div>
                                </div>
                                <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#EB459E" }}>{stats.statusCount}</div>
                                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>Status Changes</div>
                                </div>
                            </div>

                            {/* Voice Time */}
                            <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", marginBottom: "16px" }}>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>Total Voice Time</div>
                                <div style={{ fontSize: "20px", fontWeight: "bold", color: "var(--header-primary)" }}>
                                    {Math.floor(stats.totalVoiceMinutes / 60)}h {stats.totalVoiceMinutes % 60}m
                                </div>
                            </div>

                            {/* Most Active Hour */}
                            <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", marginBottom: "16px" }}>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>Most Active Hour</div>
                                <div style={{ fontSize: "16px", fontWeight: "600", color: "var(--header-primary)" }}>
                                    {stats.mostActiveHour}
                                </div>
                            </div>

                            {/* Hourly Activity Chart */}
                            <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px", marginBottom: "16px" }}>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>Activity by Hour</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "80px" }}>
                                    {Object.entries(stats.hourCounts).map(([hour, count]) => {
                                        const maxCount = Math.max(...Object.values(stats.hourCounts));
                                        const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
                                        return (
                                            <div 
                                                key={hour}
                                                style={{ 
                                                    flex: 1,
                                                    background: count > 0 ? "#5865F2" : "var(--background-secondary)",
                                                    height: `${height}%`,
                                                    borderRadius: "2px 2px 0 0",
                                                    minHeight: count > 0 ? "4px" : "2px",
                                                    opacity: count > 0 ? 1 : 0.3,
                                                    position: "relative",
                                                    cursor: "pointer"
                                                }}
                                                title={`${hour}:00 - ${count} events`}
                                            />
                                        );
                                    })}
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                                    <span>0h</span>
                                    <span>6h</span>
                                    <span>12h</span>
                                    <span>18h</span>
                                    <span>24h</span>
                                </div>
                            </div>

                            {/* Activity Heatmap */}
                            <div style={{ background: "var(--background-tertiary)", padding: "12px", borderRadius: "8px" }}>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>Activity Heatmap (Day/Hour)</div>
                                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px" }}>
                                    <div style={{ display: "grid", gridTemplateColumns: "30px repeat(24, 1fr)", gap: "2px" }}>
                                        <div></div>
                                        {[...Array(24)].map((_, h) => (
                                            <div key={h} style={{ textAlign: "center" }}>{h % 6 === 0 ? h : ""}</div>
                                        ))}
                                    </div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "30px repeat(24, 1fr)", gap: "2px" }}>
                                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, dayIdx) => (
                                        <React.Fragment key={dayIdx}>
                                            <div style={{ fontSize: "10px", color: "var(--text-muted)", display: "flex", alignItems: "center" }}>{day}</div>
                                            {[...Array(24)].map((_, hour) => {
                                                const key = `${dayIdx}-${hour}`;
                                                const count = stats.heatmapData[key] || 0;
                                                const maxHeatmap = Math.max(...Object.values(stats.heatmapData));
                                                const intensity = maxHeatmap > 0 ? count / maxHeatmap : 0;
                                                return (
                                                    <div
                                                        key={hour}
                                                        style={{
                                                            background: count > 0 ? `rgba(88, 101, 242, ${0.2 + intensity * 0.8})` : "var(--background-secondary)",
                                                            aspectRatio: "1",
                                                            borderRadius: "2px",
                                                            cursor: "pointer"
                                                        }}
                                                        title={`${day} ${hour}:00 - ${count} events`}
                                                    />
                                                );
                                            })}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        </div>
                            ) : (
                                <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>
                                    Select a user to view their statistics
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Tracked Users Card */}
                {trackedUserIds.size > 0 && (
                    <div style={{ 
                        background: "var(--background-secondary)",
                        padding: "16px",
                        borderRadius: "12px",
                        marginBottom: "20px",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
                    }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px", textTransform: "uppercase", fontWeight: "600" }}>✅ Tracked Users ({trackedUserIds.size})</div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            {Array.from(trackedUserIds).map(userId => {
                                const user = UserStore.getUser(userId);
                                const username = user ? `${user.username}` : userId;
                                return (
                                    <div key={userId} style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--background-tertiary)", padding: "6px 8px", borderRadius: "8px" }}>
                                        <span style={{ color: "white", fontSize: "13px" }}>✓ {username}</span>
                                        <Button
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.RED}
                                            onClick={() => {
                                                trackedUserIds.delete(userId);
                                            }}
                                            style={{ padding: "0 6px", height: "20px", fontSize: "12px" }}
                                        >
                                            ✕
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* User Filter Card */}
                {uniqueUsers.length > 0 && (
                    <div style={{ 
                        background: "var(--background-secondary)",
                        padding: "16px",
                        borderRadius: "12px",
                        marginBottom: "20px",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
                    }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px", textTransform: "uppercase", fontWeight: "600" }}>👥 Filter by User ({uniqueUsers.length})</div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            {uniqueUsers.map(user => {
                                const isTracked = trackedUserIds.has(user.id);
                                return (
                                    <Button
                                        key={user.id}
                                        size={Button.Sizes.SMALL}
                                        color={selectedUserId === user.id ? Button.Colors.BRAND : (isTracked ? Button.Colors.GREEN : Button.Colors.PRIMARY)}
                                        onClick={() => setSelectedUserId(selectedUserId === user.id ? null : user.id)}
                                    >
                                        {isTracked ? "✓ " : ""}{user.username}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Search Card */}
                <div style={{ 
                    background: "var(--background-secondary)",
                    padding: "16px",
                    borderRadius: "12px",
                    marginBottom: "20px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
                }}>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px", textTransform: "uppercase", fontWeight: "600" }}>🔍 Search</div>
                    <TextInput
                        placeholder="Search by username or user ID..."
                        value={searchUser}
                        onChange={setSearchUser}
                    />
                </div>

                {/* Activity Logs Card */}
                <div style={{ 
                    background: "var(--background-secondary)",
                    padding: "16px",
                    borderRadius: "12px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
                }}>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", textTransform: "uppercase", fontWeight: "600" }}>📋 Activity Logs ({userLogs.length})</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {userLogs.length === 0 ? (
                            <div style={{
                                padding: "40px",
                                textAlign: "center",
                                color: "var(--text-muted)"
                            }}>
                                <div style={{ fontSize: "48px", marginBottom: "12px" }}>📭</div>
                                <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>No logs found</div>
                                <div style={{ fontSize: "13px" }}>Start tracking users to see their activity here</div>
                            </div>
                        ) : (
                            userLogs.slice(-50).reverse().map((log, idx) => {
                                        const config = LOG_TYPE_CONFIG[log.type];
                                        return (
                                            <div key={idx} style={{
                                                background: "var(--background-tertiary)",
                                                padding: "14px",
                                                borderRadius: "10px",
                                                borderLeft: `4px solid ${config.color}`,
                                                position: "relative",
                                                transition: "transform 0.2s, box-shadow 0.2s",
                                                cursor: "pointer"
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = "translateX(4px)";
                                                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = "translateX(0)";
                                                e.currentTarget.style.boxShadow = "none";
                                            }}>
                                                <div style={{ 
                                                    display: "flex", 
                                                    alignItems: "center", 
                                                    gap: "10px",
                                                    marginBottom: "8px" 
                                                }}>
                                                    <span style={{ fontSize: "20px" }}>{config.icon}</span>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: "bold", color: "var(--header-primary)", fontSize: "14px" }}>
                                                            {log.username}
                                                        </div>
                                                        <div style={{ 
                                                            fontSize: "10px", 
                                                            color: config.color,
                                                            fontWeight: "700",
                                                            textTransform: "uppercase",
                                                            letterSpacing: "0.5px"
                                                        }}>
                                                            {config.label}
                                                        </div>
                                                    </div>
                                                    <div style={{ 
                                                        fontSize: "11px", 
                                                        color: "var(--text-muted)",
                                                        background: "var(--background-secondary)",
                                                        padding: "4px 8px",
                                                        borderRadius: "4px"
                                                    }}>
                                                        {new Date(log.timestamp).toLocaleString()}
                                                    </div>
                                                </div>
                                {log.type === "activity" && log.activities?.map((activity, i) => (
                                    <div key={i} style={{
                                        background: config.bgColor,
                                        padding: "8px",
                                        borderRadius: "4px",
                                        marginTop: "8px",
                                        borderLeft: `2px solid ${config.color}`,
                                        color: "white"
                                    }}>
                                        <div style={{ fontWeight: "500", color: "var(--header-primary)" }}>{activity.name}</div>
                                        {activity.details && <div style={{ fontSize: "12px", color: "white" }}>{activity.details}</div>}
                                        {activity.state && <div style={{ fontSize: "12px", color: "white" }}>{activity.state}</div>}
                                    </div>
                                ))}
                                {log.type === "voice" && log.voiceChannel && (
                                    <div style={{ 
                                        fontSize: "13px", 
                                        marginTop: "8px",
                                        background: config.bgColor,
                                        padding: "8px",
                                        borderRadius: "4px",
                                        color: "white"
                                    }}>
                                        <strong>{log.voiceChannel.action === "join" ? "Joined" : log.voiceChannel.action === "leave" ? "Left" : "Moved to"}</strong> voice channel <strong>"{log.voiceChannel.channelName}"</strong> in server <strong>"{log.voiceChannel.guildName || "Unknown Server"}"</strong>
                                    </div>
                                )}
                                {log.type === "message" && log.message && (
                                    <div style={{ 
                                        fontSize: "13px", 
                                        marginTop: "8px",
                                        background: config.bgColor,
                                        padding: "8px",
                                        borderRadius: "4px",
                                        fontStyle: "italic",
                                        color: "white"
                                    }}>
                                        {log.message.content}
                                    </div>
                                )}
                                {log.type === "status" && log.status && (
                                    <div style={{ 
                                        fontSize: "13px", 
                                        marginTop: "8px",
                                        background: config.bgColor,
                                        padding: "8px",
                                        borderRadius: "4px",
                                        color: "white"
                                    }}>
                                        Status changed to: <strong style={{ color: config.color }}>{log.status.status.toUpperCase()}</strong>
                                    </div>
                                )}
                                            </div>
                                        );
                                    })
                                )}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={modalProps.onClose}>Close</Button>
            </ModalFooter>
        </ModalRoot>
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
                console.log('[ActivityTracker] Opening dashboard...');
                try {
                    openModal(modalProps => {
                        console.log('[ActivityTracker] Modal props:', modalProps);
                        return (
                            <ActivityDashboard
                                logs={activityLogs}
                                modalProps={modalProps}
                            />
                        );
                    });
                } catch (e) {
                    console.error('[ActivityTracker] Error opening modal:', e);
                }
            }}
        />,
        <Menu.MenuItem
            id="activity-tracker-toggle"
            label={isTracked ? "Stop Tracking User" : "Start Tracking User"}
            action={() => {
                console.log('[ActivityTracker] Toggle tracking for user:', userId, 'Currently tracked:', isTracked);
                if (isTracked) {
                    trackedUserIds.delete(userId);
                    console.log('[ActivityTracker] Removed user from tracking');
                } else {
                    trackedUserIds.add(userId);
                    console.log('[ActivityTracker] Added user to tracking. Total tracked:', trackedUserIds.size);
                }
                saveToSettings();
                console.log('[ActivityTracker] Tracked users:', Array.from(trackedUserIds));
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
        console.log('[ActivityTracker] Plugin started, listening to events');
    },

    stop() {
        saveToSettings();
        FluxDispatcher.unsubscribe("PRESENCE_UPDATES", this.handlePresenceUpdates);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.handleMessageCreate);
        removeContextMenuPatch("user-context", UserContextMenuPatch);
    },

    handlePresenceUpdates(data: { updates: any[] }) {
        if (!data?.updates) return;

        for (const update of data.updates) {
            if (!update?.user?.id) continue;

            const shouldTrack = settings.store.autoTrackAll || trackedUserIds.has(update.user.id);
            if (!shouldTrack) continue;

            const user = UserStore.getUser(update.user.id);
            if (!user) continue;

            const currentStatus = update.status;
            const previousStatus = lastKnownStatus.get(user.id);

            console.log('[ActivityTracker] PRESENCE_UPDATES:', { 
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
                saveToSettings();
                console.log(`[ActivityTracker] ${log.username} status changed: ${previousStatus || 'none'} -> ${currentStatus}`);
                
                if (settings.store.notifyStatus && previousStatus) {
                    const name = user.globalName || user.username;
                    showNotification({
                        title: shouldBeNative() ? `${name} changed status` : "User status change",
                        body: `They are now ${currentStatus}`,
                        noPersist: !settings.store.persistNotifications,
                        richBody: getRichBody(user, `${name}'s status is now ${currentStatus}`)
                    });
                }
            }

            // Log activities
            const activities = update.activities || [];
            if (activities.length > 0) {
                const log: ActivityLog = {
                    userId: user.id,
                    username: `${user.username}`,
                    timestamp: Date.now(),
                    type: "activity",
                    activities: activities
                };
                activityLogs.push(log);
                saveToSettings();
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
            const shouldTrack = settings.store.autoTrackAll || trackedUserIds.has(state.userId);
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
            
            console.log('[ActivityTracker] Channel lookup:', {
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
            saveToSettings();
            
            console.log(`[ActivityTracker] ${log.username} voice:`, log.voiceChannel, 'Raw state:', state);
            
            if (settings.store.notifyVoice && currentChannelId !== prevChannelId) {
                const name = user.username;
                const title = shouldBeNative() ? `User ${name} changed voice status` : "User voice status change";
                if (currentChannelId) {
                    showNotification({
                        title,
                        body: "joined a new voice channel",
                        noPersist: !settings.store.persistNotifications,
                        richBody: getRichBody(user, `${name} joined a new voice channel`)
                    });
                } else {
                    showNotification({
                        title,
                        body: "left their voice channel",
                        noPersist: !settings.store.persistNotifications,
                        richBody: getRichBody(user, `${name} left their voice channel`)
                    });
                }
            }
        });
    },

    handleMessageCreate(data: any) {
        const { message } = data;
        if (!message?.author?.id) return;

        const shouldTrack = settings.store.autoTrackAll || trackedUserIds.has(message.author.id);
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
                content: message.content,
                channelId: message.channel_id,
                channelName: channel?.name || `Channel ID: ${message.channel_id}`,
                guildId: message.guild_id,
                guildName: guild?.name || (message.guild_id ? `Server ID: ${message.guild_id}` : "DM")
            }
        };

        activityLogs.push(log);
        if (activityLogs.length > MAX_LOGS) activityLogs.shift();
        saveToSettings();
        
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
            <ActivityDashboard
                logs={activityLogs}
                modalProps={modalProps}
            />
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
    },

    exportLogs() {
        return JSON.stringify(activityLogs, null, 2);
    }
});
