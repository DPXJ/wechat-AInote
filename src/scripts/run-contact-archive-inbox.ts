import { wecomContactArchiveInboxService } from "../services/wecom-contact-archive-inbox.js";

async function main(): Promise<void> {
  const result = await wecomContactArchiveInboxService.runOnce();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
