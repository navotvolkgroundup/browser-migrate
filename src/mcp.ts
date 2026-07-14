#!/usr/bin/env bun
// MCP server: exposes browser-migrate operations as tools so Claude (or any
// MCP client) can drive them. Same ops.ts the CLI uses — one source of truth.
//
// Register with Claude Code:
//   claude mcp add browser-migrate -- bun run /ABS/PATH/browser-migrate/src/mcp.ts
// or in a client's mcpServers config:
//   { "browser-migrate": { "command": "bun", "args": ["run", "/ABS/PATH/src/mcp.ts"] } }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listBrowsers,
  doctor,
  exportProfile,
  migrate,
  importBundle,
  restoreBackup,
  OpError,
} from "./ops.ts";

const server = new McpServer({ name: "browser-migrate", version: "0.1.0" });

// Wrap a handler so OpError becomes a clean tool error, not a stack trace.
function tool<T>(fn: (a: T) => Promise<unknown> | unknown) {
  return async (args: T) => {
    try {
      const result = await fn(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: e instanceof OpError ? e.message : String(e) }],
      };
    }
  };
}

server.registerTool(
  "list_browsers",
  {
    title: "List browsers",
    description: "List supported browsers, whether each is installed, and its capabilities.",
    inputSchema: {},
  },
  tool(() => listBrowsers()),
);

server.registerTool(
  "doctor",
  {
    title: "Inspect installed browsers",
    description: "Show bookmark and history counts for each installed, supported browser.",
    inputSchema: {},
  },
  tool(() => doctor()),
);

server.registerTool(
  "export_profile",
  {
    title: "Export a profile",
    description:
      "Export a browser profile to a portable bundle (manifest.json, bookmarks.json, history.json, and a universal bookmarks.html any browser can import).",
    inputSchema: {
      browser: z.string().describe("source browser id, e.g. 'chrome' (see list_browsers)"),
      outDir: z.string().describe("absolute output directory for the bundle"),
    },
  },
  tool(({ browser, outDir }: { browser: string; outDir: string }) => exportProfile(browser, outDir)),
);

server.registerTool(
  "migrate",
  {
    title: "Migrate bookmarks between browsers",
    description:
      "Copy bookmarks from one browser to another. Backs up the destination first and refuses if the destination browser is running. Use dryRun to preview.",
    inputSchema: {
      from: z.string().describe("source browser id"),
      to: z.string().describe("destination browser id"),
      dryRun: z.boolean().optional().describe("preview without writing (default false)"),
    },
  },
  tool(({ from, to, dryRun }: { from: string; to: string; dryRun?: boolean }) =>
    migrate(from, to, dryRun ?? false),
  ),
);

server.registerTool(
  "import_bundle",
  {
    title: "Import a bundle into a browser",
    description:
      "Import a previously exported bundle into a browser. Enforces the bundle version policy (refuses a newer-major format). Backs up first; refuses if the browser is running.",
    inputSchema: {
      bundleDir: z.string().describe("absolute path to a bundle directory"),
      to: z.string().describe("destination browser id"),
      dryRun: z.boolean().optional().describe("preview without writing (default false)"),
    },
  },
  tool(({ bundleDir, to, dryRun }: { bundleDir: string; to: string; dryRun?: boolean }) =>
    importBundle(bundleDir, to, dryRun ?? false),
  ),
);

server.registerTool(
  "restore",
  {
    title: "Restore a backup",
    description: "Undo a write by restoring a backup directory created by migrate/import.",
    inputSchema: {
      backupDir: z.string().describe("absolute path to the backup directory to restore"),
    },
  },
  tool(({ backupDir }: { backupDir: string }) => ({ restored: restoreBackup(backupDir) })),
);

await server.connect(new StdioServerTransport());
