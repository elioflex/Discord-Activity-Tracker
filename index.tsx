/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore, React, Menu, Forms, TextInput, ChannelStore, GuildStore } from "@webpack/common";
import { ModalRoot, ModalHeader, ModalContent, ModalFooter, openModal } from "@utils/modal";
import { Button } from "@webpack/common";
import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";

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
        guildName?: string;
    };
    message?: {
        content: string;
        channelId: string;
        guildId: string;
    };
    status?: {
        status: string;
        clientStatus?: any;
    };
}

const activityLogs: ActivityLog[] = [];
const MAX_LOGS = 1000;
const trackedUserIds = new Set<string>();

const settings = definePluginSettings({
    autoTrackAll: {
        type: OptionType.BOOLEAN,
        description: "Automatically track all users",
        default: false
    }
});

function ActivityDashboard({ logs, modalProps }: { logs: ActivityLog[], modalProps: any }) {
    const [searchUser, setSearchUser] = React.useState("");
    const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);

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

    return (
        <ModalRoot transitionState={modalProps.transitionState}>
            <ModalHeader>
                <Forms.FormTitle tag="h2">Activity Tracker Dashboard</Forms.FormTitle>
            </ModalHeader>
            <ModalContent style={{ padding: "16px", maxHeight: "600px", overflow: "auto" }}>
                <div style={{ marginBottom: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
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

                <div style={{ marginBottom: "16px" }}>
                    <Forms.FormTitle>Tracked Users ({trackedUserIds.size})</Forms.FormTitle>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
                        {Array.from(trackedUserIds).map(userId => {
                            const user = UserStore.getUser(userId);
                            const username = user ? `${user.username}` : userId;
                            return (
                                <Button
                                    key={userId}
                                    size={Button.Sizes.SMALL}
                                    color={Button.Colors.GREEN}
                                    onClick={() => {
                                        trackedUserIds.delete(userId);
                                    }}
                                >
                                    ✓ {username}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                    <Forms.FormTitle>Users with Activity Logs ({uniqueUsers.length})</Forms.FormTitle>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
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

                <TextInput
                    placeholder="Search by username or user ID..."
                    value={searchUser}
                    onChange={setSearchUser}
                    style={{ marginBottom: "16px" }}
                />

                <Forms.FormTitle>Activity Logs ({userLogs.length})</Forms.FormTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {userLogs.slice(-50).reverse().map((log, idx) => (
                        <div key={idx} style={{
                            background: "var(--background-secondary)",
                            padding: "12px",
                            borderRadius: "8px"
                        }}>
                            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                                {log.username} - {log.type}
                            </div>
                            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>
                                {new Date(log.timestamp).toLocaleString()}
                            </div>
                            {log.type === "activity" && log.activities?.map((activity, i) => (
                                <div key={i} style={{
                                    background: "var(--background-tertiary)",
                                    padding: "8px",
                                    borderRadius: "4px",
                                    marginTop: "4px"
                                }}>
                                    <div style={{ fontWeight: "500" }}>{activity.name}</div>
                                    {activity.details && <div style={{ fontSize: "12px" }}>{activity.details}</div>}
                                    {activity.state && <div style={{ fontSize: "12px" }}>{activity.state}</div>}
                                </div>
                            ))}
                            {log.type === "voice" && log.voiceChannel && (
                                <div style={{ fontSize: "12px" }}>
                                    {log.username} has {log.voiceChannel.action}ed the voice channel "{log.voiceChannel.channelName}", in the server "{log.voiceChannel.guildName || "Unknown Server"}" at {new Date(log.timestamp).toLocaleTimeString()}
                                </div>
                            )}
                            {log.type === "message" && log.message && (
                                <div style={{ fontSize: "12px", fontStyle: "italic" }}>
                                    {log.message.content}
                                </div>
                            )}
                            {log.type === "status" && log.status && (
                                <div style={{ fontSize: "12px" }}>
                                    Status: {log.status.status}
                                </div>
                            )}
                        </div>
                    ))}
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
        FluxDispatcher.subscribe("PRESENCE_UPDATE", this.handlePresenceUpdate);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.handleMessageCreate);
        addContextMenuPatch("user-context", UserContextMenuPatch);
    },

    stop() {
        FluxDispatcher.unsubscribe("PRESENCE_UPDATE", this.handlePresenceUpdate);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.handleMessageCreate);
        removeContextMenuPatch("user-context", UserContextMenuPatch);
    },

    handlePresenceUpdate(data: any) {
        if (!data?.user?.id) return;

        const shouldTrack = settings.store.autoTrackAll || trackedUserIds.has(data.user.id);
        if (!shouldTrack) return;

        const user = UserStore.getUser(data.user.id);
        if (!user) return;

        // Log status changes
        if (data.status) {
            const log: ActivityLog = {
                userId: user.id,
                username: `${user.username}`,
                timestamp: Date.now(),
                type: "status",
                status: {
                    status: data.status,
                    clientStatus: data.clientStatus
                }
            };
            activityLogs.push(log);
            console.log(`[ActivityTracker] ${log.username} status:`, data.status);
        }

        // Log activities
        const activities = data.activities || [];
        if (activities.length > 0) {
            const log: ActivityLog = {
                userId: user.id,
                username: `${user.username}`,
                timestamp: Date.now(),
                type: "activity",
                activities: activities
            };
            activityLogs.push(log);
            console.log(`[ActivityTracker] ${log.username} activity:`, activities);
        }

        if (activityLogs.length > MAX_LOGS) {
            activityLogs.shift();
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
                    channelName: channel?.name || "Unknown Channel",
                    action: action,
                    guildId: state.guildId,
                    guildName: guild?.name || "Unknown Server"
                }
            };

            activityLogs.push(log);
            if (activityLogs.length > MAX_LOGS) activityLogs.shift();
            
            console.log(`[ActivityTracker] ${log.username} voice:`, log.voiceChannel, 'Raw state:', state);
        });
    },

    handleMessageCreate(data: any) {
        const { message } = data;
        if (!message?.author?.id) return;

        const shouldTrack = settings.store.autoTrackAll || trackedUserIds.has(message.author.id);
        if (!shouldTrack) return;

        const log: ActivityLog = {
            userId: message.author.id,
            username: `${message.author.username}`,
            timestamp: Date.now(),
            type: "message",
            message: {
                content: message.content,
                channelId: message.channel_id,
                guildId: message.guild_id
            }
        };

        activityLogs.push(log);
        if (activityLogs.length > MAX_LOGS) activityLogs.shift();
        
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
