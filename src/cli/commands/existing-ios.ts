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

const request = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([z.literal("lease"), z.string().optional()]),
  z.tuple([z.literal("register"), z.uuid()]),
  z.tuple([z.literal("unregister"), z.uuid()]),
  z.tuple([z.literal("release"), z.uuid()]),
]);

export async function run(
  argv: readonly string[],
  { environment, url, daemonFlag }: CommandContext,
) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    environment.stdout.write(usage);
    return 0;
  }
  if (url !== undefined || daemonFlag === "gateway" || process.platform !== "darwin") {
    throw new UsageError("existing-ios runs locally on macOS.");
  }
  const parsed = request.safeParse(argv);
  if (!parsed.success) throw new UsageError(usage.trimEnd());

  const registry = await existingIosRegistry(userInfo().homedir);
  try {
    const result = await execute(registry, parsed.data);
    if (result !== undefined) environment.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } finally {
    registry.close();
  }
}

async function execute(
  registry: Awaited<ReturnType<typeof existingIosRegistry>>,
  [operation, value]: z.infer<typeof request>,
) {
  switch (operation) {
    case "list":
      return registry.list();
    case "lease":
      return registry.lease(value ?? "");
    case "register":
      return registry.register(value.toUpperCase());
    case "unregister":
      return registry.unregister(value.toUpperCase());
    case "release":
      return registry.release(value.toLowerCase());
  }
}
