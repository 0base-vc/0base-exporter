import { lintAbiFiles, resolveAbiLintTargets } from "../src/core/abi-lint";

function main(): void {
  const targets = resolveAbiLintTargets(process.argv.slice(2));
  const errors = lintAbiFiles(targets);

  if (errors.length === 0) {
    return;
  }

  console.error("ABI JSON lint failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exitCode = 1;
}

main();
