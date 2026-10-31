import { io, type Socket } from "socket.io-client";
import type {
  NotificationSummary,
  PresenceUser,
  ProjectPresenceEvent,
  RealtimeTaskEvent,
} from "@orbit/contracts";

interface ServerToClientEvents {
  "task:changed": (event: RealtimeTaskEvent) => void;
  "presence:update": (event: ProjectPresenceEvent) => void;
  "notification:new": (notification: NotificationSummary) => void;
  "notification:read": (event: { id: string; readAt: string }) => void;
  "notifications:read-all": (event: { readAt: string }) => void;
  "project:joined": (event: { projectId: string }) => void;
}

interface ClientToServerEvents {
  "project:join": (event: { projectId: string }) => void;
  "project:leave": (event: { projectId: string }) => void;
}

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | undefined;

export function getRealtimeSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  socket ??= io({
    autoConnect: false,
    withCredentials: true,
  });
  return socket;
}

export function connectRealtime(): void {
  const connection = getRealtimeSocket();
  if (!connection.connected) connection.connect();
}

export function disconnectRealtime(): void {
  socket?.disconnect();
}

export function joinProjectRoom(projectId: string): () => void {
  const connection = getRealtimeSocket();
  const join = () => connection.emit("project:join", { projectId });
  connection.on("connect", join);
  if (connection.connected) join();

  return () => {
    connection.off("connect", join);
    if (connection.connected) connection.emit("project:leave", { projectId });
  };
}

export type { PresenceUser };
