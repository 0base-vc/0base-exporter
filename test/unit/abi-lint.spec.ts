import fs from "fs";
import os from "os";
import path from "path";
import { findAbiJsonFiles, lintAbiFiles, validateAbiDocument } from "../../src/core/abi-lint";

describe("abi lint", () => {
  it("accepts a valid ABI fragment with tuple components", () => {
    const errors = validateAbiDocument(
      [
        {
          type: "function",
          name: "setConfig",
          inputs: [
            {
              name: "config",
              type: "tuple",
              components: [
                { name: "owner", type: "address" },
                { name: "threshold", type: "uint256" },
              ],
            },
          ],
          outputs: [],
        },
      ],
      "valid.json",
    );

    expect(errors).toEqual([]);
  });

  it("reports invalid ABI fragment structure", () => {
    const errors = validateAbiDocument(
      [
        {
          name: "broken",
          inputs: [{ name: 123, type: "" }],
        },
      ],
      "invalid.json",
    );

    expect(errors).toEqual([
      "invalid.json[0].type must be a non-empty string",
      "invalid.json[0].inputs[0].type must be a non-empty string",
      "invalid.json[0].inputs[0].name must be a string when provided",
    ]);
  });

  it("parses files and reports syntax errors", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "abi-lint-"));
    const validFile = path.join(tempDir, "valid.json");
    const invalidFile = path.join(tempDir, "invalid.json");
    const brokenFile = path.join(tempDir, "broken.json");

    fs.writeFileSync(validFile, JSON.stringify([{ type: "function", name: "ok", inputs: [] }]));
    fs.writeFileSync(invalidFile, JSON.stringify([{ outputs: "bad" }]));
    fs.writeFileSync(brokenFile, "{not-json");

    const errors = lintAbiFiles([validFile, invalidFile, brokenFile]);

    expect(errors).toEqual([
      `${invalidFile}[0].type must be a non-empty string`,
      `${invalidFile}[0].outputs must be an array when provided`,
      `${brokenFile}: Expected property name or '}' in JSON at position 1 (line 1 column 2)`,
    ]);
  });

  it("discovers abi json files recursively", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "abi-find-"));
    const abiRoot = path.join(tempDir, "src", "abi");
    const nestedDir = path.join(abiRoot, "nested");

    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(abiRoot, "root.json"), "[]");
    fs.writeFileSync(path.join(nestedDir, "child.json"), "[]");
    fs.writeFileSync(path.join(nestedDir, "ignore.txt"), "skip");

    expect(findAbiJsonFiles(abiRoot)).toEqual([
      path.join(nestedDir, "child.json"),
      path.join(abiRoot, "root.json"),
    ]);
  });
});
