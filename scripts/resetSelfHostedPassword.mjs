import "dotenv/config";
import { randomBytes } from "node:crypto";
import { SelfHostedAccountStore } from "../src/server/SelfHostedAccountStore.ts";

const username = process.argv[2]?.trim();
if (!username) {
  console.error("Usage: npm run account:reset -- <username>");
  process.exit(1);
}

const temporaryPassword = randomBytes(15).toString("base64url");
const store = new SelfHostedAccountStore();
try {
  const account = store.resetPasswordByUsername(username, temporaryPassword);
  if (!account) {
    console.error(`Account not found: ${username}`);
    process.exitCode = 1;
  } else {
    console.log(`Password reset for ${account.username}.`);
    console.log(`Temporary password: ${temporaryPassword}`);
    console.log("Sign in and change this password immediately on the My page.");
  }
} finally {
  store.close();
}
