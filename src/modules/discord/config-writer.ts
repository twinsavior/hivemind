import * as fs from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ── .env file helpers ─────────────────────────────────────────────────────────

/**
 * Append or update a KEY=value line in a .env file.
 * Preserves comments and existing lines. Creates the file if it doesn't exist.
 */
export function updateEnvFile(filePath: string, key: string, value: string): void {
  let lines: string[] = [];

  if (fs.existsSync(filePath)) {
    lines = fs.readFileSync(filePath, "utf-8").split("\n");
  }

  // Find existing line for this key (skip comments)
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const lineKey = trimmed.slice(0, eqIdx).trim();
    if (lineKey === key) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    // Ensure there's a blank line before adding
    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
      lines.push("");
    }
    lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

// ── YAML config helpers ───────────────────────────────────────────────────────

interface ConnectorYamlConfig {
  type: string;
  name: string;
  config: Record<string, unknown>;
}

/**
 * Update or add a connector entry in hivemind.yaml.
 * If a connector with the same name exists, it's replaced. Otherwise it's added.
 */
export function updateYamlConnector(filePath: string, connector: ConnectorYamlConfig): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  // Ensure connectors is an array
  if (!Array.isArray(doc["connectors"])) {
    doc["connectors"] = [];
  }

  const connectors = doc["connectors"] as Array<Record<string, unknown>>;

  // Find existing connector with same name
  const idx = connectors.findIndex(
    (c) => c["name"] === connector.name,
  );

  const entry: Record<string, unknown> = {
    type: connector.type,
    name: connector.name,
    config: connector.config,
  };

  if (idx >= 0) {
    connectors[idx] = entry;
  } else {
    connectors.push(entry);
  }

  fs.writeFileSync(filePath, stringifyYaml(doc, { lineWidth: 120 }), "utf-8");
}

/**
 * Update the security.ownerIds for a specific connector in hivemind.yaml.
 */
export function updateYamlOwnerIds(
  filePath: string,
  connectorName: string,
  ids: string[],
): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  // Ensure security.ownerIds exists
  if (!doc["security"] || typeof doc["security"] !== "object") {
    doc["security"] = {};
  }
  const security = doc["security"] as Record<string, unknown>;

  if (!security["ownerIds"] || typeof security["ownerIds"] !== "object") {
    security["ownerIds"] = {};
  }
  const ownerIds = security["ownerIds"] as Record<string, string[]>;

  ownerIds[connectorName] = ids;

  fs.writeFileSync(filePath, stringifyYaml(doc, { lineWidth: 120 }), "utf-8");
}
