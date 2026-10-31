import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type {
  NotificationSummary,
  PresenceUser,
  ProjectPresenceEvent,
  RealtimeTaskEvent,
} from "@orbit/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { getSessionToken, hashSessionToken } from "../auth/auth-session";

interface RealtimeSocket extends Socket {
  data: {
    sessionId: string;
    userId: string;
    userName: string;
    workspaceIds: string[];
    projectIds: string[];
  };
}

function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

function workspaceRoom(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const expectedOrigin = process.env.FRONTEND_URL ?? "http://localhost:5173";
      callback(null, origin === expectedOrigin || origin === undefined);
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  afterInit(server: Server): void {
    this.server = server;
    server.use((client, next) => {
      void this.authenticate(client).then(
        () => next(),
        (error: unknown) => {
          if (!(error instanceof Error) || error.message !== "Unauthorized realtime session.") {
            this.logger.error(
              "Could not authenticate a realtime connection.",
              error instanceof Error ? error.stack : undefined,
            );
          }
          next(new Error("Unauthorized"));
        },
      );
    });
  }

  private async authenticate(client: Socket): Promise<void> {
    const token = getSessionToken(client.handshake.headers.cookie);
    if (!token) throw new Error("Unauthorized realtime session.");

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            name: true,
            workspaceMemberships: { select: { workspaceId: true } },
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new Error("Unauthorized realtime session.");
    }

    const socket = client as RealtimeSocket;
    const workspaceIds = session.user.workspaceMemberships.map(({ workspaceId }) => workspaceId);
    socket.data = {
      userId: session.user.id,
      sessionId: session.id,
      userName: session.user.name,
      workspaceIds,
      projectIds: [],
    };
    await socket.join(userRoom(session.user.id));
    await socket.join(workspaceIds.map(workspaceRoom));
    const timer = setTimeout(
      () => client.disconnect(true),
      Math.max(0, session.expiresAt.getTime() - Date.now()),
    );
    timer.unref();
    this.expiryTimers.set(client.id, timer);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const expiryTimer = this.expiryTimers.get(client.id);
    if (expiryTimer) clearTimeout(expiryTimer);
    this.expiryTimers.delete(client.id);

    const socket = client as RealtimeSocket;
    const projectIds = Array.isArray(socket.data?.projectIds) ? socket.data.projectIds : [];
    await Promise.all(projectIds.map((projectId) => this.publishPresence(projectId)));
  }

  @SubscribeMessage("project:join")
  async joinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const socket = client as RealtimeSocket;
    const projectId = isRecord(payload) ? payload.projectId : undefined;
    if (
      typeof projectId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(projectId)
    ) {
      throw new WsException("A valid project id is required.");
    }

    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: { members: { some: { userId: socket.data.userId } } },
      },
      select: { id: true },
    });
    if (!project) {
      throw new WsException("Project access is required to join this room.");
    }

    await socket.join(projectRoom(projectId));
    if (!socket.data.projectIds.includes(projectId)) socket.data.projectIds.push(projectId);
    socket.emit("project:joined", { projectId });
    await this.publishPresence(projectId);
  }

  @SubscribeMessage("project:leave")
  async leaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const socket = client as RealtimeSocket;
    const projectId = isRecord(payload) ? payload.projectId : undefined;
    if (typeof projectId !== "string" || !socket.data.projectIds.includes(projectId)) return;

    await socket.leave(projectRoom(projectId));
    socket.data.projectIds = socket.data.projectIds.filter((id) => id !== projectId);
    await this.publishPresence(projectId);
  }

  publishTaskEvent(event: RealtimeTaskEvent): void {
    this.server.to(projectRoom(event.projectId)).emit("task:changed", event);
  }

  publishNotification(userId: string, notification: NotificationSummary): void {
    this.server.to(userRoom(userId)).emit("notification:new", notification);
  }

  publishNotificationRead(userId: string, notificationId: string, readAt: string): void {
    this.server.to(userRoom(userId)).emit("notification:read", { id: notificationId, readAt });
  }

  publishNotificationsReadAll(userId: string, readAt: string): void {
    this.server.to(userRoom(userId)).emit("notifications:read-all", { readAt });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    for (const socket of sockets) {
      if (socket.data.sessionId === sessionId) socket.disconnect(true);
    }
  }

  async revokeWorkspaceAccess(workspaceId: string, userId: string): Promise<void> {
    const userSockets = await this.server.in(userRoom(userId)).fetchSockets();
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const projectIds = projects.map(({ id }) => id);
    const projectIdSet = new Set(projectIds);
    const sockets = userSockets.filter(
      (socket) =>
        socket.data.workspaceIds?.includes(workspaceId) ||
        (Array.isArray(socket.data.projectIds) &&
          socket.data.projectIds.some((projectId: string) => projectIdSet.has(projectId))),
    );
    if (sockets.length === 0) return;

    for (const socket of sockets) {
      await socket.leave(workspaceRoom(workspaceId));
      for (const projectId of projectIds) {
        await socket.leave(projectRoom(projectId));
      }
      if (Array.isArray(socket.data.projectIds)) {
        socket.data.projectIds = socket.data.projectIds.filter(
          (projectId: string) => !projectIds.includes(projectId),
        );
      }
      if (Array.isArray(socket.data.workspaceIds)) {
        socket.data.workspaceIds = socket.data.workspaceIds.filter(
          (id: string) => id !== workspaceId,
        );
      }
      socket.emit("workspace:access-revoked", { workspaceId });
    }

    await Promise.all(projectIds.map((projectId) => this.publishPresence(projectId)));
  }

  private async publishPresence(projectId: string): Promise<void> {
    const sockets = await this.server.in(projectRoom(projectId)).fetchSockets();
    const users = new Map<string, PresenceUser>();
    for (const socket of sockets) {
      const userId = socket.data.userId;
      const userName = socket.data.userName;
      if (typeof userId === "string" && typeof userName === "string") {
        users.set(userId, { id: userId, name: userName });
      }
    }

    const event: ProjectPresenceEvent = {
      projectId,
      users: [...users.values()].sort((first, second) => first.name.localeCompare(second.name)),
    };
    this.server.to(projectRoom(projectId)).emit("presence:update", event);
  }
}
