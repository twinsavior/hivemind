import { Router, json } from "express";
import * as path from "node:path";
import { updateEnvFile, updateYamlConnector, updateYamlOwnerIds } from "./config-writer.js";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Create an Express router for Discord setup endpoints.
 * Mounted at /api/connectors/discord by the dashboard server.
 */
export function createDiscordRouter(): Router {
  const router = Router();
  router.use(json());

  // ── Verify bot token ────────────────────────────────────────────────────

  router.post("/verify", async (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token || typeof token !== "string") {
      res.json({ valid: false, error: "Token is required" });
      return;
    }

    try {
      // Fetch bot user info
      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${token.trim()}` },
      });

      if (!userRes.ok) {
        const errText = await userRes.text();
        res.json({ valid: false, error: `Discord API error: ${userRes.status} — ${errText}` });
        return;
      }

      const user = (await userRes.json()) as {
        id: string;
        username: string;
        avatar: string | null;
        discriminator: string;
      };

      // Fetch the application info to get the client ID (needed for invite URL)
      let clientId = user.id; // Bot user ID works as client ID for invite
      try {
        const appRes = await fetch(`${DISCORD_API}/oauth2/applications/@me`, {
          headers: { Authorization: `Bot ${token.trim()}` },
        });
        if (appRes.ok) {
          const app = (await appRes.json()) as { id: string };
          clientId = app.id;
        }
      } catch {
        // Non-critical — bot user ID works as fallback for invite URL
      }

      res.json({
        valid: true,
        botId: user.id,
        botName: user.username,
        botAvatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
          : null,
        clientId,
      });
    } catch (err) {
      res.json({ valid: false, error: (err as Error).message });
    }
  });

  // ── List bot's guilds ───────────────────────────────────────────────────

  router.post("/guilds", async (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.json({ guilds: [] });
      return;
    }

    try {
      const gRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bot ${token.trim()}` },
      });

      if (!gRes.ok) {
        res.json({ guilds: [], error: `Discord API error: ${gRes.status}` });
        return;
      }

      const guilds = (await gRes.json()) as Array<{
        id: string;
        name: string;
        icon: string | null;
      }>;

      res.json({
        guilds: guilds.map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon
            ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=48`
            : null,
        })),
      });
    } catch (err) {
      res.json({ guilds: [], error: (err as Error).message });
    }
  });

  // ── List guild's text channels ──────────────────────────────────────────

  router.post("/channels", async (req, res) => {
    const { token, guildId } = req.body as { token?: string; guildId?: string };
    if (!token || !guildId) {
      res.json({ channels: [] });
      return;
    }

    try {
      const cRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${token.trim()}` },
      });

      if (!cRes.ok) {
        res.json({ channels: [], error: `Discord API error: ${cRes.status}` });
        return;
      }

      const channels = (await cRes.json()) as Array<{
        id: string;
        name: string;
        type: number;
        position: number;
      }>;

      // Type 0 = text channel, type 5 = announcement channel
      const textChannels = channels
        .filter((c) => c.type === 0 || c.type === 5)
        .sort((a, b) => a.position - b.position);

      res.json({
        channels: textChannels.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type === 5 ? "announcement" : "text",
        })),
      });
    } catch (err) {
      res.json({ channels: [], error: (err as Error).message });
    }
  });

  // ── Save config and (optionally) start connector ────────────────────────

  router.post("/save", async (req, res) => {
    const {
      token,
      guildIds = [],
      channelIds = [],
      ownerIds = [],
      triggerMode = "mention",
    } = req.body as {
      token?: string;
      guildIds?: string[];
      channelIds?: string[];
      ownerIds?: string[];
      triggerMode?: string;
    };

    if (!token) {
      res.status(400).json({ status: "error", error: "Token is required" });
      return;
    }

    try {
      const envPath = path.resolve(".env");
      const yamlPath = path.resolve("hivemind.yaml");

      // 1. Save token to .env
      updateEnvFile(envPath, "DISCORD_BOT_TOKEN", token.trim());

      // 2. Update hivemind.yaml with connector config
      updateYamlConnector(yamlPath, {
        type: "discord",
        name: "discord",
        config: {
          token: "$DISCORD_BOT_TOKEN",
          guildIds,
          channelIds,
          triggerMode,
          listenAllChannels: [],
        },
      });

      // 3. Update owner IDs
      if (ownerIds.length > 0) {
        updateYamlOwnerIds(yamlPath, "discord", ownerIds);
      }

      res.json({ status: "ok" });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Check Discord status ────────────────────────────────────────────────

  router.get("/status", async (_req, res) => {
    // Check if DISCORD_BOT_TOKEN is set
    const token = process.env["DISCORD_BOT_TOKEN"];
    const configured = Boolean(token);

    if (!configured) {
      res.json({ configured: false, connected: false });
      return;
    }

    // Try to validate the token is still good
    try {
      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${token}` },
      });

      if (userRes.ok) {
        const user = (await userRes.json()) as { id: string; username: string };
        res.json({
          configured: true,
          connected: true,
          botName: user.username,
          botId: user.id,
        });
      } else {
        res.json({ configured: true, connected: false, error: "Token invalid" });
      }
    } catch {
      res.json({ configured: true, connected: false, error: "Cannot reach Discord" });
    }
  });

  return router;
}
