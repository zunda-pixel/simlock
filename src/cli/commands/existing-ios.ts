import { userInfo } from "node:os";
import { z } from "zod";
import { existingIosRegistry } from "../../existing-ios/index.js";
import type { CommandContext } from "../tree.js";
import { UsageError } from "../usage-error.js";

const usage = `Usage: simlock existing-ios register <UDID>
       simlock existing-ios list
       simlock existing-ios lease [name-prefix]
       simlock existing-ios release <lease-ID>
       simlock existing-ios unregister <UDID>
`;

export async function run(
  argv: readonly string[],
  { environment, url, daemonFlag }: CommandContext,
) {
  const [operation, value, ...extra] = argv;
  if (operation === undefined || operation === "--help" || operation === "-h") {
    environment.stdout.write(usage);
    return 0;
  }
  if (url !== undefined || daemonFlag === "gateway" || process.platform !== "darwin") {
    throw new UsageError("existing-ios runs locally on macOS.");
  }
  const ids = z.uuid();
  const hasId = operation === "register" || operation === "unregister" || operation === "release";
  const parsed = ids.safeParse(value);
  if (
    extra.length > 0 ||
    (hasId && !parsed.success) ||
    (operation === "list" && value !== undefined) ||
    (!hasId && operation !== "lease" && operation !== "list")
  ) {
    throw new UsageError(usage.trimEnd());
  }

  const registry = await existingIosRegistry(userInfo().homedir);
  try {
    if (operation === "list") {
      environment.stdout.write(JSON.stringify(registry.list()) + "\n");
    } else if (operation === "lease") {
      environment.stdout.write(JSON.stringify(await registry.lease(value ?? "")) + "\n");
    } else if (parsed.success) {
      switch (operation) {
        case "register":
          environment.stdout.write(
            JSON.stringify(await registry.register(parsed.data.toUpperCase())) + "\n",
          );
          break;
        case "unregister":
          registry.unregister(parsed.data.toUpperCase());
          break;
        case "release":
          registry.release(parsed.data.toLowerCase());
          break;
      }
    }
    return 0;
  } finally {
    registry.close();
  }
}
