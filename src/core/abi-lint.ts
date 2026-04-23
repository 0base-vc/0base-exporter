import fs from "fs";
import path from "path";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAbiParameter(
  parameter: unknown,
  location: string,
  errors: string[],
): asserts parameter is JsonObject {
  if (!isJsonObject(parameter)) {
    errors.push(`${location} must be an object`);
    return;
  }

  if (typeof parameter.type !== "string" || parameter.type.trim().length === 0) {
    errors.push(`${location}.type must be a non-empty string`);
  }

  if ("name" in parameter && typeof parameter.name !== "string") {
    errors.push(`${location}.name must be a string when provided`);
  }

  if ("components" in parameter) {
    if (!Array.isArray(parameter.components)) {
      errors.push(`${location}.components must be an array when provided`);
      return;
    }

    parameter.components.forEach((component, index) => {
      validateAbiParameter(component, `${location}.components[${index}]`, errors);
    });
  }
}

function validateAbiFragment(fragment: unknown, location: string, errors: string[]): void {
  if (!isJsonObject(fragment)) {
    errors.push(`${location} must be an object`);
    return;
  }

  if (typeof fragment.type !== "string" || fragment.type.trim().length === 0) {
    errors.push(`${location}.type must be a non-empty string`);
  }

  if ("name" in fragment && typeof fragment.name !== "string") {
    errors.push(`${location}.name must be a string when provided`);
  }

  if ("stateMutability" in fragment && typeof fragment.stateMutability !== "string") {
    errors.push(`${location}.stateMutability must be a string when provided`);
  }

  if ("anonymous" in fragment && typeof fragment.anonymous !== "boolean") {
    errors.push(`${location}.anonymous must be a boolean when provided`);
  }

  if ("constant" in fragment && typeof fragment.constant !== "boolean") {
    errors.push(`${location}.constant must be a boolean when provided`);
  }

  if ("payable" in fragment && typeof fragment.payable !== "boolean") {
    errors.push(`${location}.payable must be a boolean when provided`);
  }

  if ("inputs" in fragment) {
    if (!Array.isArray(fragment.inputs)) {
      errors.push(`${location}.inputs must be an array when provided`);
    } else {
      fragment.inputs.forEach((input, index) => {
        validateAbiParameter(input, `${location}.inputs[${index}]`, errors);
      });
    }
  }

  if ("outputs" in fragment) {
    if (!Array.isArray(fragment.outputs)) {
      errors.push(`${location}.outputs must be an array when provided`);
    } else {
      fragment.outputs.forEach((output, index) => {
        validateAbiParameter(output, `${location}.outputs[${index}]`, errors);
      });
    }
  }
}

export function validateAbiDocument(document: unknown, filePath: string): string[] {
  const errors: string[] = [];

  if (!Array.isArray(document)) {
    return [`${filePath}: ABI root must be an array`];
  }

  document.forEach((fragment, index) => {
    validateAbiFragment(fragment, `${filePath}[${index}]`, errors);
  });

  return errors;
}

export function lintAbiFiles(filePaths: string[]): string[] {
  const errors: string[] = [];

  for (const filePath of filePaths) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      errors.push(...validateAbiDocument(parsed, filePath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${filePath}: ${message}`);
    }
  }

  return errors;
}

export function findAbiJsonFiles(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  return entries
    .flatMap((entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return findAbiJsonFiles(entryPath);
      }

      if (entry.isFile() && entry.name.endsWith(".json")) {
        return [entryPath];
      }

      return [];
    })
    .sort();
}

export function resolveAbiLintTargets(args: string[], cwd: string = process.cwd()): string[] {
  if (args.length === 0) {
    return findAbiJsonFiles(path.resolve(cwd, "src/abi"));
  }

  return [...new Set(args.map((filePath) => path.resolve(cwd, filePath)))].sort();
}
