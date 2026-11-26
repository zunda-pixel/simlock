import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  inTransaction,
  NodeFilesystem,
  NodeProcessRunner,
  NodeSqliteOpener,
} from "../ports/index.js";

const simulator = z.object({ udid: z.uuid(), name: z.string(), isAvailable: z.boolean() });
const listing = z.object({ devices: z.record(z.string(), z.array(simulator)) });
const entry = z.object({ udid: z.uuid(), name: z.string(), leaseId: z.uuid().nullable() });

export async function existingIosRegistry(home: string) {
  const root = join(home, ".simlock");
  const filesystem = new NodeFilesystem();
  const runner = new NodeProcessRunner();
  await filesystem.mkdirp(root, { mode: 0o700 });
  const db = await new NodeSqliteOpener().open(join(root, "existing-ios.sqlite"), {
    readOnly: false,
  });
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS simulator (
        udid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        leaseId TEXT UNIQUE
      );
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const all = () =>
    z.array(entry).parse(db.prepare("SELECT * FROM simulator ORDER BY name, udid").all());
  async function available() {
    const result = await runner.run("/usr/bin/xcrun", ["simctl", "list", "devices", "-j"], {
      timeoutMs: 30_000,
      maxStdoutBytes: 8 * 1024 * 1024,
    });
    if (result.code !== 0 || result.endedBy !== undefined) {
      throw new Error("Could not list Xcode's default simulator device set.");
    }
    return Object.values(listing.parse(JSON.parse(result.stdout)).devices)
      .flat()
      .filter((device) => device.isAvailable)
      .map((device) => ({ ...device, udid: device.udid.toUpperCase() }));
  }

  return {
    close: () => db.close(),
    list: all,
    async register(udid: string) {
      const found = (await available()).find((device) => device.udid === udid);
      const device = join(home, "Library", "Developer", "CoreSimulator", "Devices", udid);
      if (found === undefined || !(await filesystem.exists(join(device, "device.plist")))) {
        throw new Error("Simulator is unavailable in Xcode's default device set.");
      }
      for (const directory of [device, join(device, "data")]) {
        if (await filesystem.exists(join(directory, "simlock-mark.json"))) {
          throw new Error("This simulator is already managed by Simlock.");
        }
      }
      db.prepare(`
        INSERT INTO simulator (udid, name) VALUES (?, ?)
        ON CONFLICT (udid) DO UPDATE SET name = excluded.name
      `).run(udid, found.name);
      return entry.parse(db.prepare("SELECT * FROM simulator WHERE udid = ?").get(udid));
    },
    async lease(prefix: string) {
      const live = new Map((await available()).map((device) => [device.udid, device.name]));
      return inTransaction(db, () => {
        const device = all().find(
          (candidate) => candidate.leaseId === null && live.get(candidate.udid)?.startsWith(prefix),
        );
        if (device === undefined) throw new Error("No matching registered simulator is free.");
        const leaseId = randomUUID();
        db.prepare("UPDATE simulator SET leaseId = ? WHERE udid = ?").run(leaseId, device.udid);
        return { ...device, name: live.get(device.udid) ?? device.name, leaseId };
      });
    },
    release(leaseId: string) {
      const { changes } = db
        .prepare("UPDATE simulator SET leaseId = NULL WHERE leaseId = ?")
        .run(leaseId);
      if (Number(changes) === 0) throw new Error("Unknown existing simulator lease.");
    },
    unregister(udid: string) {
      const { changes } = db
        .prepare("DELETE FROM simulator WHERE udid = ? AND leaseId IS NULL")
        .run(udid);
      if (Number(changes) === 0) throw new Error("Simulator is not registered or is still leased.");
    },
  };
}
