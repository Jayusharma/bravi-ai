import fs from "fs";
import path from "path";

const graph = JSON.parse(
  fs.readFileSync(path.join(__dirname, "graph.json"), "utf-8")
);

function getRelatedFiles(entry: string, depth = 2) {
  const visited = new Set<string>();
  const result: string[] = [];

  function dfs(file: string, level: number) {
    if (level > depth || visited.has(file)) return;

    visited.add(file);
    result.push(file);

    const deps = graph[file] || [];

    for (const dep of deps) {
      // simple match (we’ll improve later)
      function resolveImport(fromFile: string, dep: string) {
  if (!dep.startsWith(".")) return null; // ignore external libs

        const resolved = path.resolve(path.dirname(fromFile), dep);

        return Object.keys(graph).find((f) =>
          f.startsWith(resolved)
        );
      }

      const match = resolveImport(file, dep);

      if (match) dfs(match, level + 1);
    }
  }

  dfs(entry, 0);
  return result;
}

// test
const testFile = Object.keys(graph).find((f) =>
  f.includes("check-ability.decorator")
);

console.log(getRelatedFiles(testFile!, 2));