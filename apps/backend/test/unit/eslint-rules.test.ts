import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../../../", import.meta.url)) });

async function restrictedSyntaxErrors(code: string) {
  const [result] = await eslint.lintText(code, { filePath: "apps/backend/src/example.ts" });
  return result!.messages.filter((message) => message.ruleId === "no-restricted-syntax");
}

describe("launching npx and npm", () => {
  it.each([
    'spawn("npm", ["run", "x"]);',
    'execFileSync("npx", ["supabase"]);',
    'childProcess.spawn("npm", ["run", "x"]);',
    'childProcess.execFile("npx", ["supabase"]);',
  ])("rejects %s", async (code) => {
    expect(await restrictedSyntaxErrors(code)).toHaveLength(1);
  });

  it.each(['spawn(process.execPath, ["server.js"]);', 'execSync("npx supabase status");'])(
    "allows %s",
    async (code) => {
      expect(await restrictedSyntaxErrors(code)).toHaveLength(0);
    },
  );
});
