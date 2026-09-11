import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
export function violation(source: string, target: string): string | undefined {
  const s = source.split("/"),
    t = target.split("/");
  if (s[0] === "packages" && (t[0] === "modules" || t[0] === "apps"))
    return "Packages cannot import modules/apps";
  if (s[0] === "modules" && t[0] === "apps")
    return "Modules cannot import apps";
  if (s[0] === "apps" && t[0] === "apps" && s[1] !== t[1])
    return "Apps are independent composition roots";
  if (
    s[0] === "modules" &&
    t[0] === "modules" &&
    s[1] !== t[1] &&
    target !== `modules/${t[1]}/index.ts`
  )
    return "Cross-module imports must use public index";
  if (
    s[0] === "modules" &&
    ["domain", "application"].includes(s[2]!) &&
    (t[2] === "infrastructure" || t[2] === "interfaces")
  )
    return "Inner layers cannot import outer layers";
  if (
    s[0] === "modules" &&
    s[2] === "domain" &&
    (t[2] === "application" ||
      (t[0] === "packages" &&
        !["shared-kernel", "event-contracts"].includes(t[1]!)))
  )
    return "Domain dependency is not pure";
  return undefined;
}
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(p)));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
export async function check(): Promise<void> {
  const graph = new Map<string, string[]>();
  const errors: string[] = [];
  for (const dir of ["apps", "modules", "packages"])
    for (const file of await files(dir)) {
      const source = ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const edges: string[] = [];
      function visit(node: ts.Node) {
        let spec: string | undefined;
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          spec = node.moduleSpecifier.text;
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            node.expression.getText(source) === "require")
        ) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) spec = arg.text;
          else errors.push(`${file}: nonliteral import is forbidden`);
        }
        if (spec) {
          let target: string | undefined;
          if (spec.startsWith("."))
            target = path.posix
              .normalize(path.posix.join(path.posix.dirname(file), spec))
              .replace(/\.js$/, ".ts");
          else if (spec.startsWith("@itcenter/")) {
            const name = spec.slice("@itcenter/".length);
            if (name.includes("/")) errors.push(`${file}: package deep import`);
            target = ["identity", "audit"].includes(name)
              ? `modules/${name}/index.ts`
              : `packages/${name}/src/index.ts`;
          } else if (
            file.startsWith("modules/") &&
            file.split("/")[2] === "domain"
          )
            errors.push(`${file}: external domain dependency ${spec}`);
          if (target) {
            const error = violation(file, target);
            if (error) errors.push(`${file}: ${error} (${spec})`);
            edges.push(target);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      graph.set(file, edges);
    }
  const done = new Set<string>(),
    active = new Set<string>();
  function walk(file: string) {
    if (active.has(file)) {
      errors.push(`Circular dependency: ${file}`);
      return;
    }
    if (done.has(file)) return;
    active.add(file);
    for (const to of graph.get(file) ?? []) walk(to);
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) walk(file);
  if (errors.length) throw new Error(errors.join("\n"));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await check();
