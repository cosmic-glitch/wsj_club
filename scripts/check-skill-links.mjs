import { access, lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sharedSkills = ["wsj-pick-article", "wsj-reading"];
const failures = [];

for (const skill of sharedSkills) {
  const agentPath = path.join(root, ".agents", "skills", skill);
  const claudePath = path.join(root, ".claude", "skills", skill);
  const expectedLink = path.join("..", "..", ".claude", "skills", skill);

  try {
    const stats = await lstat(agentPath);
    if (!stats.isSymbolicLink()) {
      failures.push(`${agentPath} must be a symlink`);
      continue;
    }

    const link = await readlink(agentPath);
    if (link !== expectedLink) {
      failures.push(`${agentPath} points to ${link}, expected ${expectedLink}`);
      continue;
    }

    const [agentTarget, claudeTarget] = await Promise.all([
      realpath(agentPath),
      realpath(claudePath),
    ]);
    if (agentTarget !== claudeTarget) {
      failures.push(`${agentPath} does not resolve to ${claudePath}`);
      continue;
    }

    await access(path.join(agentPath, "SKILL.md"));
  } catch (error) {
    failures.push(`${agentPath}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error("Shared skill link check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Shared skill links are valid (${sharedSkills.length}).`);
}
