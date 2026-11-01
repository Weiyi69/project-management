import "reflect-metadata";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import type { RealtimeTaskEvent } from "@orbit/contracts";
import { hashSessionToken } from "../auth/auth-session";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "./realtime.gateway";

const sessionToken = "test-session-token";
const observerSessionToken = "observer-session-token";
const projectId = "61b77378-0a0a-44de-8b78-774f7601892d";
const userId = "15442c08-e919-4a81-ac54-e5d7b42102dd";
const observerId = "31d68011-d164-47f6-a6b8-da52204573c2";
const workspaceId = "ed7abe70-253b-47c2-aee4-449a4c726675";

const prismaStub = {
  refreshSession: {
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      where.tokenHash === hashSessionToken(sessionToken)
        ? {
            id: "session-id",
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            user: {
              id: userId,
              name: "Test User",
              emailVerifiedAt: new Date(),
              workspaceMemberships: [{ workspaceId }],
            },
          }
        : where.tokenHash === hashSessionToken(observerSessionToken)
          ? {
              id: "observer-session-id",
              revokedAt: null,
              expiresAt: new Date(Date.now() + 60_000),
              user: {
                id: observerId,
                name: "Observer",
                emailVerifiedAt: new Date(),
                workspaceMemberships: [{ workspaceId }],
              },
            }
        : null,
  },
  project: {
    findFirst: async ({
      where,
    }: {
      where: { id: string; workspace: { members: { some: { userId: string } } } };
    }) =>
      where.id === projectId &&
      [userId, observerId].includes(where.workspace.members.some.userId)
        ? { id: projectId }
        : null,
    findMany: async () => [{ id: projectId }],
  },
} as unknown as PrismaService;

const httpServer = createServer();
const socketServer = new Server(httpServer);
const gateway = new RealtimeGateway(prismaStub);
let serverUrl = "";

function waitFor<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for Socket.IO event "${event}".`));
    }, 2_000);
    const listener = (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as T);
    };
    socket.once(event, listener);
  });
}

function makeClient(cookie?: string): ClientSocket {
  return createClient(serverUrl, {
    autoConnect: false,
    reconnection: false,
    timeout: 1_000,
    transports: ["websocket"],
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
  });
}

async function closeClient(client: ClientSocket): Promise<void> {
  if (!client.connected) {
    client.close();
    return;
  }
  const disconnected = waitFor<string>(client, "disconnect");
  client.close();
  await disconnected;
}

before(async () => {
  gateway.afterInit(socketServer);
  socketServer.on("connection", (socket) => {
    socket.on("project:join", (payload: unknown) => {
      void gateway.joinProject(socket, payload).catch(() => {
        socket.emit("project:access-denied");
      });
    });
    socket.on("project:leave", (payload: unknown) => {
      void gateway.leaveProject(socket, payload);
    });
    socket.on("disconnect", () => {
      void gateway.handleDisconnect(socket);
    });
  });

  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
});

test("rejects a Socket.IO connection without the authenticated session cookie", async () => {
  const client = makeClient();
  const connectionError = waitFor<Error>(client, "connect_error");
  client.connect();
  const error = await connectionError;

  assert.equal(error.message, "Unauthorized");
  assert.equal(client.connected, false);
  await closeClient(client);
});

test("authenticates sessions, authorizes project rooms, and broadcasts task/presence events", async () => {
  const client = makeClient(`orbit_session=${sessionToken}`);
  const connected = waitFor<void>(client, "connect");
  client.connect();
  await connected;

  const joined = waitFor<{ projectId: string }>(client, "project:joined");
  const presence = waitFor<{ projectId: string; users: Array<{ id: string; name: string }> }>(
    client,
    "presence:update",
  );
  client.emit("project:join", { projectId });
  assert.deepEqual(await joined, { projectId });
  assert.deepEqual(await presence, {
    projectId,
    users: [{ id: userId, name: "Test User" }],
  });

  const taskChanged = waitFor<RealtimeTaskEvent>(client, "task:changed");
  const event: RealtimeTaskEvent = {
    projectId,
    taskId: "1f916474-9f48-454f-84ca-a54be23bbbc5",
    actorId: userId,
    action: "updated",
  };
  gateway.publishTaskEvent(event);
  assert.deepEqual(await taskChanged, event);

  const notification = {
    id: "notification-id",
    type: "TASK_ASSIGNED" as const,
    entityType: "TASK",
    entityId: event.taskId!,
    createdAt: new Date().toISOString(),
    readAt: null,
    actor: { id: userId, name: "Test User" },
    task: { title: "Test task", projectId, projectName: "Test project" },
  };
  const notificationEvent = waitFor<typeof notification>(client, "notification:new");
  gateway.publishNotification(userId, notification);
  assert.deepEqual(await notificationEvent, notification);

  const observer = makeClient(`orbit_session=${observerSessionToken}`);
  const observerConnected = waitFor<void>(observer, "connect");
  observer.connect();
  await observerConnected;
  const observerJoined = waitFor<{ projectId: string }>(observer, "project:joined");
  const observerPresence = waitFor<{
    projectId: string;
    users: Array<{ id: string; name: string }>;
  }>(observer, "presence:update");
  const sharedPresence = waitFor<{
    projectId: string;
    users: Array<{ id: string; name: string }>;
  }>(client, "presence:update");
  observer.emit("project:join", { projectId });
  await observerJoined;
  assert.deepEqual(await observerPresence, {
    projectId,
    users: [
      { id: observerId, name: "Observer" },
      { id: userId, name: "Test User" },
    ],
  });
  await sharedPresence;

  const remainingPresence = waitFor<{
    projectId: string;
    users: Array<{ id: string; name: string }>;
  }>(observer, "presence:update");
  client.emit("project:leave", { projectId });
  assert.deepEqual(await remainingPresence, {
    projectId,
    users: [{ id: observerId, name: "Observer" }],
  });
  await closeClient(observer);

  const denied = waitFor<void>(client, "project:access-denied");
  client.emit("project:join", { projectId: "786cb709-f48b-45ed-9b6b-1e0f3482732d" });
  await denied;

  const serverDisconnect = waitFor<string>(client, "disconnect");
  await gateway.revokeSession(userId, "session-id");
  assert.equal(await serverDisconnect, "io server disconnect");
});
