import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import ts from "typescript";
import {
  type CapabilityChange,
  type CodeMatch,
  type AnalysisLimitation,
  type MatchContext,
  type ScanArtifact,
  type VendorNoticeArtifact
} from "../domain/artifacts.js";

const SOURCE_EXTENSIONS = new Map([
  [".js", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
  [".ts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX]
]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage"]);

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      files.push(...sourceFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files.sort();
}

function contextFor(file: string): MatchContext {
  const normalized = file.replaceAll("\\", "/");
  if (/(^|\/)(__tests__|test|tests)(\/|$)|\.(test|spec)\.[^.]+$/.test(normalized)) return "test";
  if (/(^|\/)(example|examples)(\/|$)/.test(normalized)) return "example";
  return "source";
}

function importedSlackClients(sourceFile: ts.SourceFile): Set<string> {
  const imported = new Set<string>();
  sourceFile.forEachChild(node => {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier.getText(sourceFile) !== '"@slack/web-api"') return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const element of bindings.elements) {
      if (element.propertyName?.text === "WebClient" || element.name.text === "WebClient") {
        imported.add(element.name.text);
      }
    }
  });
  return imported;
}

function clientVariables(sourceFile: ts.SourceFile, importedClients: Set<string>): Set<string> {
  const clients = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isNewExpression(node.initializer)) {
      const constructor = node.initializer.expression;
      if (ts.isIdentifier(node.name) && ts.isIdentifier(constructor) && importedClients.has(constructor.text)) {
        clients.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return clients;
}

function slackClientVariableForUpload(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "upload") return null;
  const filesAccess = expression.expression;
  if (!ts.isPropertyAccessExpression(filesAccess) || filesAccess.name.text !== "files") return null;
  return ts.isIdentifier(filesAccess.expression) ? filesAccess.expression.text : null;
}

function dynamicFilesUpload(expression: ts.Expression): boolean {
  if (!ts.isElementAccessExpression(expression) || !ts.isStringLiteral(expression.argumentExpression) || expression.argumentExpression.text !== "upload") return false;
  const filesAccess = expression.expression;
  return ts.isElementAccessExpression(filesAccess) && ts.isStringLiteral(filesAccess.argumentExpression) && filesAccess.argumentExpression.text === "files";
}

function repositoryLocation(file: string, repositoryRoot: string, sourceFile: ts.SourceFile, node: ts.Node): { file: string; line: number } {
  return {
    file: relative(repositoryRoot, file).replaceAll("\\", "/"),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  };
}

function matchesInFile(file: string, repositoryRoot: string, capabilityChange: CapabilityChange): { matches: CodeMatch[]; limitations: AnalysisLimitation[] } {
  const content = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, SOURCE_EXTENSIONS.get(extname(file)));
  const importedClients = importedSlackClients(sourceFile);
  const clients = clientVariables(sourceFile, importedClients);
  const matches: CodeMatch[] = [];
  const limitations: AnalysisLimitation[] = [];
  const unresolvedLocations = new Set<string>();
  const addLimitation = (node: ts.Node, reason: string): void => {
    const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
    const key = `${location.file}:${location.line}:${reason}`;
    if (unresolvedLocations.has(key)) return;
    unresolvedLocations.add(key);
    limitations.push({ ...location, reason });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const receiver = slackClientVariableForUpload(node.expression);
      if (receiver && clients.has(receiver)) {
        const lineStart = sourceFile.getLineStarts()[sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line];
        const lineEnd = content.indexOf("\n", lineStart);
        matches.push({
          vendor: capabilityChange.vendor,
          capabilityIdentifier: capabilityChange.canonicalIdentifier,
          file: relative(repositoryRoot, file).replaceAll("\\", "/"),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          evidenceStrength: "direct",
          context: contextFor(relative(repositoryRoot, file)),
          evidence: content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd).trim()
        });
      } else if (receiver) {
        addLimitation(node, "The files.upload receiver is not proven to be a Slack client.");
      } else if ((ts.isElementAccessExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "files") || dynamicFilesUpload(node.expression)) {
        addLimitation(node, "Computed files method access cannot be statically proven.");
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "upload" && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "files" && !ts.isCallExpression(node.parent)) {
      addLimitation(node, "A files.upload reference was not used as a directly provable call.");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (importedClients.size > 0 && matches.length === 0 && limitations.length === 0) {
    addLimitation(sourceFile, "This file imports the Slack client, but no supported direct files.upload call was proven.");
  }
  return { matches, limitations };
}

export function scanLocalRepository(repositoryPath: string, notice: VendorNoticeArtifact): ScanArtifact {
  const repositoryRoot = resolve(repositoryPath);
  if (!existsSync(resolve(repositoryRoot, "package.json"))) {
    throw new Error("scan requires one repository root package.json");
  }

  const fileResults = sourceFiles(repositoryRoot).map(file => matchesInFile(file, repositoryRoot, notice.capabilityChange));
  const codeMatches = fileResults.flatMap(result => result.matches);
  const limitations = fileResults.flatMap(result => result.limitations);
  return {
    schemaVersion: 1,
    kind: "scan-result",
    notice: notice.notice,
    capabilityChange: notice.capabilityChange,
    codeMatches,
    limitations,
    impact: codeMatches.length > 0 ? { capabilityChange: notice.capabilityChange, codeMatches } : null
  };
}
