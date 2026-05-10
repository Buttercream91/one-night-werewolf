import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as IOServer } from "socket.io";
import type { ClientToServer, ServerToClient } from "../shared/types.js";
import { registerRoomHandlers } from "./handlers.js";
import { rooms } from "./rooms.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3001);
const isProd = process.env.NODE_ENV === "production";

const app = express();
const httpServer = createServer(app);

const io = new IOServer<ClientToServer, ServerToClient>(httpServer, {
  cors: isProd ? undefined : { origin: "http://localhost:5173" },
});
rooms.attachIO(io);

io.on("connection", (socket) => {
  console.log(`[onuw] + connect ${socket.id}`);
  socket.on("disconnect", (reason) => {
    console.log(`[onuw] - disconnect ${socket.id} (${reason})`);
  });
  registerRoomHandlers(socket);
});

if (isProd) {
  // In prod, the built client lives in dist/client (sibling of dist/server).
  const clientDir = path.resolve(__dirname, "../client");
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

httpServer.listen(PORT, () => {
  console.log(`[onuw] listening on :${PORT} (${isProd ? "prod" : "dev"})`);
});
