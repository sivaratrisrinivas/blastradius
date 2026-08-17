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
const ASSIGNMENT_OPERATOR_KINDS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
]);

interface RepositoryLocation {
  file: string;
  line: number;
}

interface FileScanResult {
  matches: CodeMatch[];
  limitations: AnalysisLimitation[];
}

type BindingKind = "unknown" | "slack-constructor" | "slack-client";

interface Binding {
  kind: BindingKind;
  declaration?: ts.VariableDeclaration;
}

interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
  isVarBoundary: boolean;
}

interface ScopeModel {
  scopeForNode: ReadonlyMap<ts.Node, Scope>;
}

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

function importedSlackConstructorNames(sourceFile: ts.SourceFile): Set<string> {
  const imported = new Set<string>();
  sourceFile.forEachChild(node => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "@slack/web-api") return;
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

function hasSlackImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@slack/web-api");
}

function hasSlackRequire(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "@slack/web-api") found = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function bindingForName(scope: Scope | null, name: string): Binding | undefined {
  for (let current = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(element.name) : []);
}

function assignedIdentifiers(expression: ts.Expression): ts.Identifier[] {
  if (ts.isIdentifier(expression)) return [expression];
  if (ts.isParenthesizedExpression(expression)) return assignedIdentifiers(expression.expression);
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap(element => {
      if (ts.isSpreadElement(element)) return assignedIdentifiers(element.expression);
      return ts.isOmittedExpression(element) ? [] : assignedIdentifiers(element);
    });
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap(property => {
      if (ts.isShorthandPropertyAssignment(property)) return [property.name];
      if (ts.isPropertyAssignment(property)) return assignedIdentifiers(property.initializer);
      return ts.isSpreadAssignment(property) ? assignedIdentifiers(property.expression) : [];
    });
  }
  return [];
}

function createScopeModel(sourceFile: ts.SourceFile, importedSlackConstructorNames: Set<string>): ScopeModel {
  const scopes: Scope[] = [];
  const scopeForNode = new Map<ts.Node, Scope>();
  const root: Scope = { parent: null, bindings: new Map(), isVarBoundary: true };
  scopes.push(root);

  const addBinding = (scope: Scope, name: string, binding: Binding): void => {
    const existing = scope.bindings.get(name);
    if (existing) {
      existing.kind = "unknown";
      delete existing.declaration;
      return;
    }
    scope.bindings.set(name, binding);
  };

  const nearestVarScope = (scope: Scope): Scope => {
    for (let current = scope; current.parent; current = current.parent) {
      if (current.isVarBoundary) return current;
    }
    return root;
  };

  const addVariableBindings = (scope: Scope, declarationList: ts.VariableDeclarationList): void => {
    const targetScope = declarationList.flags & ts.NodeFlags.BlockScoped ? scope : nearestVarScope(scope);
    for (const declaration of declarationList.declarations) {
      for (const name of bindingNames(declaration.name)) {
        addBinding(targetScope, name, {
          kind: "unknown",
          declaration: ts.isIdentifier(declaration.name) ? declaration : undefined
        });
      }
    }
  };

  const addUnknownBinding = (scope: Scope, name: ts.BindingName): void => {
    for (const bindingName of bindingNames(name)) addBinding(scope, bindingName, { kind: "unknown" });
  };

  const collectStatementBindings = (scope: Scope, statement: ts.Statement): void => {
    if (ts.isImportDeclaration(statement)) {
      const importClause = statement.importClause;
      if (!importClause) return;
      if (importClause.name) addBinding(scope, importClause.name.text, { kind: "unknown" });
      if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        addBinding(scope, importClause.namedBindings.name.text, { kind: "unknown" });
      }
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          addBinding(scope, element.name.text, {
            kind: importedSlackConstructorNames.has(element.name.text) ? "slack-constructor" : "unknown"
          });
        }
      }
      return;
    }
    if (ts.isVariableStatement(statement)) {
      addVariableBindings(scope, statement.declarationList);
      return;
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) addBinding(scope, statement.name.text, { kind: "unknown" });
    }
  };

  const collectScopeBindings = (scope: Scope, statements: ts.NodeArray<ts.Statement>): void => {
    for (const statement of statements) collectStatementBindings(scope, statement);
  };

  const createScope = (parent: Scope, isVarBoundary = false): Scope => {
    const scope: Scope = { parent, bindings: new Map(), isVarBoundary };
    scopes.push(scope);
    return scope;
  };

  const visit = (node: ts.Node, scope: Scope): void => {
    if (ts.isSourceFile(node)) {
      scopeForNode.set(node, scope);
      collectScopeBindings(scope, node.statements);
      for (const child of node.statements) visit(child, scope);
      return;
    }
    if (ts.isBlock(node)) {
      const blockScope = createScope(scope);
      scopeForNode.set(node, blockScope);
      collectScopeBindings(blockScope, node.statements);
      for (const child of node.statements) visit(child, blockScope);
      return;
    }
    if (ts.isFunctionLike(node)) {
      const functionScope = createScope(scope, true);
      scopeForNode.set(node, functionScope);
      for (const parameter of node.parameters) {
        addUnknownBinding(functionScope, parameter.name);
      }
      ts.forEachChild(node, child => visit(child, functionScope));
      return;
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const loopScope = createScope(scope);
      scopeForNode.set(node, loopScope);
      if (ts.isForStatement(node) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        addVariableBindings(loopScope, node.initializer);
      }
      if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && ts.isVariableDeclarationList(node.initializer)) {
        addVariableBindings(loopScope, node.initializer);
      }
      ts.forEachChild(node, child => visit(child, loopScope));
      return;
    }
    if (ts.isCatchClause(node)) {
      const catchScope = createScope(scope);
      scopeForNode.set(node, catchScope);
      if (node.variableDeclaration) addUnknownBinding(catchScope, node.variableDeclaration.name);
      ts.forEachChild(node, child => visit(child, catchScope));
      return;
    }
    if (ts.isSwitchStatement(node)) {
      const switchScope = createScope(scope);
      scopeForNode.set(node, switchScope);
      for (const clause of node.caseBlock.clauses) collectScopeBindings(switchScope, clause.statements);
      ts.forEachChild(node, child => visit(child, switchScope));
      return;
    }
    scopeForNode.set(node, scope);
    ts.forEachChild(node, child => visit(child, scope));
  };

  visit(sourceFile, root);

  for (const scope of scopes) {
    for (const binding of scope.bindings.values()) {
      const initializer = binding.declaration?.initializer;
      if (binding.kind !== "unknown" || !initializer || !ts.isNewExpression(initializer)) continue;
      const constructor = initializer.expression;
      if (ts.isIdentifier(constructor) && bindingForName(scope, constructor.text)?.kind === "slack-constructor") {
        binding.kind = "slack-client";
      }
    }
  }

  const markReassignedIdentifier = (identifier: ts.Identifier): void => {
    const binding = bindingForName(scopeForNode.get(identifier) ?? null, identifier.text);
    if (binding?.kind === "slack-client") binding.kind = "unknown";
  };
  const markReassignments = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_KINDS.has(node.operatorToken.kind)) {
      for (const identifier of assignedIdentifiers(node.left)) markReassignedIdentifier(identifier);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand)) {
      markReassignedIdentifier(node.operand);
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && ts.isIdentifier(node.initializer)) {
      markReassignedIdentifier(node.initializer);
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      for (const identifier of assignedIdentifiers(node.initializer)) markReassignedIdentifier(identifier);
    }
    ts.forEachChild(node, markReassignments);
  };
  markReassignments(sourceFile);

  return { scopeForNode };
}

function isProvenSlackClient(identifier: ts.Identifier, scopeModel: ScopeModel): boolean {
  return bindingForName(scopeModel.scopeForNode.get(identifier) ?? null, identifier.text)?.kind === "slack-client";
}

function slackClientVariableForUpload(expression: ts.Expression): ts.Identifier | null {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "upload") return null;
  const filesAccess = expression.expression;
  if (!ts.isPropertyAccessExpression(filesAccess) || filesAccess.name.text !== "files") return null;
  return ts.isIdentifier(filesAccess.expression) ? filesAccess.expression : null;
}

function dynamicFilesUpload(expression: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === "upload" && ts.isElementAccessExpression(expression.expression)) {
    return ts.isStringLiteral(expression.expression.argumentExpression) && expression.expression.argumentExpression.text === "files";
  }
  if (!ts.isElementAccessExpression(expression)) return false;
  const filesAccess = expression.expression;
  return (ts.isElementAccessExpression(filesAccess) || ts.isPropertyAccessExpression(filesAccess)) && ((ts.isElementAccessExpression(filesAccess) && ts.isStringLiteral(filesAccess.argumentExpression) && filesAccess.argumentExpression.text === "files") || (ts.isPropertyAccessExpression(filesAccess) && filesAccess.name.text === "files"));
}

function repositoryLocation(file: string, repositoryRoot: string, sourceFile: ts.SourceFile, node: ts.Node): RepositoryLocation {
  return {
    file: relative(repositoryRoot, file).replaceAll("\\", "/"),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  };
}

function matchesInFile(file: string, repositoryRoot: string, capabilityChange: CapabilityChange): FileScanResult {
  const content = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, SOURCE_EXTENSIONS.get(extname(file)));
  const importedConstructorNames = importedSlackConstructorNames(sourceFile);
  const scopeModel = createScopeModel(sourceFile, importedConstructorNames);
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
      if (receiver && isProvenSlackClient(receiver, scopeModel)) {
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
  if ((hasSlackImport(sourceFile) || hasSlackRequire(sourceFile)) && matches.length === 0 && limitations.length === 0) {
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
