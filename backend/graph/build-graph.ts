import ts from "typescript";
import fs from "fs";
import path from "path";

function getAllFiles(dir: string, files: string[] = []) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      if (file === "node_modules" || file.startsWith(".")) continue;
      getAllFiles(fullPath, files);
    } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImports(filePath: string) {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.Latest,
    true
  );

  const imports: string[] = [];

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      const module = (node.moduleSpecifier as ts.StringLiteral).text;
      imports.push(module);
    }
  });

  return imports;
}

function buildGraph(rootDir: string) {
  const files = getAllFiles(rootDir);
  const graph: Record<string, string[]> = {};

  for (const file of files) {
    graph[file] = extractImports(file);
  }

  return graph;
}

const projectRoot = path.resolve(__dirname, "../src"); // adjust if needed
const graph = buildGraph(projectRoot);

fs.writeFileSync(
  path.join(__dirname, "graph.json"),
  JSON.stringify(graph, null, 2)
);

console.log("Graph built successfully");