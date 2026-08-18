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
import { CLOUDFLARE_LEGACY_NAMESPACE_ROUTE_MARKER, type CapabilityMatcher } from "../domain/capabilities.js";

const SOURCE_EXTENSIONS = new Map([
  [".js", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
  [".ts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX]
]);
const CONFIG_EXTENSIONS = new Set([".json", ".toml"]);
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

type BindingKind =
  | "unknown"
  | "slack-constructor"
  | "slack-client"
  | "openai-constructor"
  | "openai-client"
  | "openai-client-alias"
  | "openai-beta"
  | "openai-beta-alias"
  | "openai-assistants"
  | "openai-assistants-alias";

interface Binding {
  kind: BindingKind;
  declaration?: ts.VariableDeclaration;
  ambiguous?: boolean;
}

interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
  isVarBoundary: boolean;
}

interface ScopeModel {
  scopeForNode: ReadonlyMap<ts.Node, Scope>;
}

function repositoryFiles(directory: string, extensions: ReadonlyMap<string, ts.ScriptKind> | ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      files.push(...repositoryFiles(resolve(directory, entry.name), extensions));
    } else if (entry.isFile() && (extensions instanceof Map ? extensions.has(extname(entry.name)) : extensions.has(extname(entry.name)))) {
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
    return expression.elements.flatMap(element => ts.isSpreadElement(element)
      ? assignedIdentifiers(element.expression)
      : ts.isOmittedExpression(element) ? [] : assignedIdentifiers(element));
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

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrapExpression(expression.expression);
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) return unwrapExpression(expression.expression);
  return expression;
}

function propertyName(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : null;
}

function createScopeModel(sourceFile: ts.SourceFile): ScopeModel {
  const scopes: Scope[] = [];
  const scopeForNode = new Map<ts.Node, Scope>();
  const root: Scope = { parent: null, bindings: new Map(), isVarBoundary: true };
  scopes.push(root);

  const addBinding = (scope: Scope, name: string, binding: Binding): void => {
    const existing = scope.bindings.get(name);
    if (existing) {
      existing.kind = "unknown";
      delete existing.declaration;
      existing.ambiguous = true;
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
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
      if (importClause.name) {
        addBinding(scope, importClause.name.text, {
          kind: moduleName === "openai" ? "openai-constructor" : "unknown"
        });
      }
      if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        addBinding(scope, importClause.namedBindings.name.text, { kind: "unknown" });
      }
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const isSlackConstructor = moduleName === "@slack/web-api" && (element.propertyName?.text === "WebClient" || element.name.text === "WebClient");
          const isOpenAIConstructor = moduleName === "openai" && (element.propertyName?.text === "OpenAI" || element.name.text === "OpenAI" || element.propertyName?.text === "default");
          addBinding(scope, element.name.text, { kind: isSlackConstructor ? "slack-constructor" : isOpenAIConstructor ? "openai-constructor" : "unknown" });
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
    scopeForNode.set(node, scope);
    if (ts.isSourceFile(node)) {
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
      for (const parameter of node.parameters) addUnknownBinding(functionScope, parameter.name);
      ts.forEachChild(node, child => visit(child, functionScope));
      return;
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const loopScope = createScope(scope);
      scopeForNode.set(node, loopScope);
      if (ts.isForStatement(node) && node.initializer && ts.isVariableDeclarationList(node.initializer)) addVariableBindings(loopScope, node.initializer);
      if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && ts.isVariableDeclarationList(node.initializer)) addVariableBindings(loopScope, node.initializer);
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
    ts.forEachChild(node, child => visit(child, scope));
  };

  visit(sourceFile, root);

  const setKind = (scope: Scope | null, name: string, kind: BindingKind): void => {
    const binding = bindingForName(scope, name);
    if (binding && !binding.ambiguous) binding.kind = kind;
  };

  const expressionKind = (expression: ts.Expression, scope: Scope): BindingKind => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return bindingForName(scope, value.text)?.kind ?? "unknown";
    if (ts.isElementAccessExpression(value)) return "unknown";
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "require" &&
      bindingForName(scope, "require") === undefined &&
      value.arguments.length === 1 && ts.isStringLiteral(value.arguments[0]) && value.arguments[0].text === "openai") {
      return "openai-constructor";
    }
    if (ts.isNewExpression(value) && ts.isIdentifier(value.expression)) {
      const constructorKind = bindingForName(scope, value.expression.text)?.kind;
      if (constructorKind === "slack-constructor") return "slack-client";
      if (constructorKind === "openai-constructor") return "openai-client";
      return "unknown";
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const baseKind = expressionKind(value.expression, scope);
      if (baseKind === "openai-constructor" && (propertyName(value) === "default" || propertyName(value) === "OpenAI")) return "openai-constructor";
      const name = propertyName(value);
      if ((baseKind === "openai-client" || baseKind === "openai-client-alias") && name === "beta") {
        return baseKind === "openai-client" ? "openai-beta" : "openai-beta-alias";
      }
      if ((baseKind === "openai-beta" || baseKind === "openai-beta-alias") && name === "assistants") {
        return baseKind === "openai-beta" ? "openai-assistants" : "openai-assistants-alias";
      }
    }
    return "unknown";
  };

  const inferDeclaration = (declaration: ts.VariableDeclaration): void => {
    if (!declaration.initializer) return;
    const scope = scopeForNode.get(declaration) ?? root;
    const initializer = unwrapExpression(declaration.initializer);
    if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && bindingForName(scope, "require") === undefined && initializer.arguments.length === 1 && ts.isStringLiteral(initializer.arguments[0]) && initializer.arguments[0].text === "openai") {
      if (ts.isIdentifier(declaration.name)) {
        setKind(scope, declaration.name.text, "openai-constructor");
        return;
      }
    }
    if (ts.isIdentifier(declaration.name)) {
      const kind = expressionKind(initializer, scope);
      if (kind !== "unknown") setKind(scope, declaration.name.text, ts.isNewExpression(initializer) ? kind : aliasKind(kind));
      return;
    }
    if (ts.isObjectBindingPattern(declaration.name)) {
      const inferDestructuredKind = (baseKind: BindingKind, selectedName: string): BindingKind => {
        if (baseKind === "openai-constructor" && (selectedName === "default" || selectedName === "OpenAI")) return "openai-constructor";
        if ((baseKind === "openai-client" || baseKind === "openai-client-alias") && selectedName === "beta") return "openai-beta-alias";
        if ((baseKind === "openai-beta" || baseKind === "openai-beta-alias") && selectedName === "assistants") return "openai-assistants-alias";
        return "unknown";
      };
      const inferBindingPattern = (pattern: ts.BindingName, baseKind: BindingKind): void => {
        if (ts.isIdentifier(pattern)) {
          if (baseKind !== "unknown") setKind(scope, pattern.text, baseKind);
          return;
        }
        for (const element of pattern.elements) {
          if (!ts.isBindingElement(element)) continue;
          const selectedName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name) ? element.name.text : null;
          if (selectedName === null) continue;
          inferBindingPattern(element.name, inferDestructuredKind(baseKind, selectedName));
        }
      };
      inferBindingPattern(declaration.name, expressionKind(initializer, scope));
    }
  };

  const aliasKind = (kind: BindingKind): BindingKind => {
    if (kind === "openai-client") return "openai-client-alias";
    if (kind === "openai-beta") return "openai-beta-alias";
    if (kind === "openai-assistants") return "openai-assistants-alias";
    return kind;
  };

  const infer = (node: ts.Node): void => {
    const scope = scopeForNode.get(node) ?? root;
    if (ts.isVariableDeclaration(node)) inferDeclaration(node);
    if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_KINDS.has(node.operatorToken.kind)) {
      const kind = node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? aliasKind(expressionKind(node.right, scope)) : "unknown";
      for (const identifier of assignedIdentifiers(node.left)) setKind(scope, identifier.text, kind);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(node.operand)) {
      setKind(scope, node.operand.text, "unknown");
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      for (const identifier of assignedIdentifiers(node.initializer)) setKind(scope, identifier.text, "unknown");
    }
    ts.forEachChild(node, infer);
  };
  for (let pass = 0; pass < 3; pass++) infer(sourceFile);

  return { scopeForNode };
}

function lineEvidence(content: string, sourceFile: ts.SourceFile, node: ts.Node): string {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const lineStart = sourceFile.getLineStarts()[line];
  const lineEnd = content.indexOf("\n", lineStart);
  return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();
}

function repositoryLocation(file: string, repositoryRoot: string, sourceFile: ts.SourceFile, node: ts.Node): RepositoryLocation {
  return {
    file: relative(repositoryRoot, file).replaceAll("\\", "/"),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  };
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

function slackUploadReceiver(expression: ts.Expression, scopeModel: ScopeModel): ts.Identifier | null {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "upload") return null;
  const files = expression.expression;
  if (!ts.isPropertyAccessExpression(files) || files.name.text !== "files" || !ts.isIdentifier(files.expression)) return null;
  const binding = bindingForName(scopeModel.scopeForNode.get(files.expression) ?? null, files.expression.text);
  return binding?.kind === "slack-client" ? files.expression : null;
}

function hasSlackUploadSyntax(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "upload" && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "files";
}

function memberAccessHasComputedSlackEndpoint(expression: ts.Expression, scopeModel: ScopeModel): boolean {
  let current: ts.Expression = expression;
  const segments: Array<{ name: string | null; computed: boolean }> = [];
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    segments.unshift({ name: propertyName(current), computed: ts.isElementAccessExpression(current) });
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return false;
  const binding = bindingForName(scopeModel.scopeForNode.get(current) ?? null, current.text);
  if (binding?.kind !== "slack-client") return false;
  if (segments.length === 1) return segments[0].computed;
  const endpoint = segments.slice(-2);
  return endpoint.every(segment => segment.name === null || segment.name === "files" || segment.name === "upload") && endpoint.some(segment => segment.computed);
}

function matchesSlackFile(file: string, repositoryRoot: string, capabilityChange: CapabilityChange): FileScanResult {
  const content = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, SOURCE_EXTENSIONS.get(extname(file)));
  const scopeModel = createScopeModel(sourceFile);
  const matches: CodeMatch[] = [];
  const limitations: AnalysisLimitation[] = [];
  const seen = new Set<string>();
  const addLimitation = (node: ts.Node, reason: string): void => {
    const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
    const key = `${location.file}:${location.line}:${reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      limitations.push({ ...location, reason });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const receiver = slackUploadReceiver(node.expression, scopeModel);
      if (receiver) {
        const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
        matches.push({ vendor: capabilityChange.vendor, capabilityIdentifier: capabilityChange.canonicalIdentifier, ...location, evidenceStrength: "direct", context: contextFor(location.file), evidence: lineEvidence(content, sourceFile, node) });
      } else if (hasSlackUploadSyntax(node.expression)) {
        addLimitation(node, "The files.upload receiver is not proven to be a Slack client.");
      } else if (memberAccessHasComputedSlackEndpoint(node.expression, scopeModel)) {
        addLimitation(node, "Computed or dynamic Slack endpoint access cannot be statically proven.");
      }
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberAccessHasComputedSlackEndpoint(node, scopeModel) && !ts.isCallExpression(node.parent)) {
      addLimitation(node, "Computed or dynamic Slack endpoint access cannot be statically proven.");
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

function openAIAssistantEvidence(expression: ts.Expression, scopeModel: ScopeModel): "direct" | "alias-traced" | null {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "create") return null;
  const base = expression.expression;
  if (ts.isPropertyAccessExpression(base) && base.name.text === "assistants") {
    const beta = base.expression;
    if (ts.isPropertyAccessExpression(beta) && beta.name.text === "beta") {
      const client = beta.expression;
      if (!ts.isIdentifier(client)) return null;
      const clientKind = bindingForName(scopeModel.scopeForNode.get(client) ?? null, client.text)?.kind;
      return clientKind === "openai-client" ? "direct" : clientKind === "openai-client-alias" ? "alias-traced" : null;
    }
  }
  if (ts.isIdentifier(base)) {
    const baseKind = bindingForName(scopeModel.scopeForNode.get(base) ?? null, base.text)?.kind;
    return baseKind === "openai-assistants" || baseKind === "openai-assistants-alias" ? "alias-traced" : null;
  }
  return null;
}

function hasOpenAIAssistantCreateSyntax(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "create") return false;
  const base = expression.expression;
  return ts.isPropertyAccessExpression(base) && base.name.text === "assistants" && ts.isPropertyAccessExpression(base.expression) && base.expression.name.text === "beta";
}

function openAIAssistantDynamicAccess(expression: ts.Expression, scopeModel: ScopeModel): boolean {
  let current: ts.Expression = expression;
  const segments: Array<{ name: string | null; computed: boolean }> = [];
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    segments.unshift({ name: propertyName(current), computed: ts.isElementAccessExpression(current) });
    current = current.expression;
  }
  if (!ts.isIdentifier(current) || segments.length === 0) return false;
  const binding = bindingForName(scopeModel.scopeForNode.get(current) ?? null, current.text);
  if (binding?.kind !== "openai-client" && binding?.kind !== "openai-client-alias") return false;
  return segments.slice(0, 2).every((segment, index) => segment.name === null || segment.name === ["beta", "assistants"][index]) &&
    segments.some(segment => segment.computed || segment.name === null);
}

function matchesOpenAIFile(file: string, repositoryRoot: string, capabilityChange: CapabilityChange): FileScanResult {
  const content = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, SOURCE_EXTENSIONS.get(extname(file)));
  const scopeModel = createScopeModel(sourceFile);
  const matches: CodeMatch[] = [];
  const limitations: AnalysisLimitation[] = [];
  const seenLimitations = new Set<string>();
  const addLimitation = (node: ts.Node, reason: string): void => {
    const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
    const key = `${location.file}:${location.line}:${reason}`;
    if (seenLimitations.has(key)) return;
    seenLimitations.add(key);
    limitations.push({ ...location, reason });
  };
  const visit = (node: ts.Node): void => {
    const evidence = ts.isCallExpression(node) ? openAIAssistantEvidence(node.expression, scopeModel) : null;
    if (ts.isCallExpression(node) && evidence !== null) {
      const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
      matches.push({ vendor: capabilityChange.vendor, capabilityIdentifier: capabilityChange.canonicalIdentifier, ...location, evidenceStrength: evidence, context: contextFor(location.file), evidence: lineEvidence(content, sourceFile, node) });
    } else if (ts.isCallExpression(node) && hasOpenAIAssistantCreateSyntax(node.expression)) {
      addLimitation(node, "The beta.assistants.create receiver is not proven to be an OpenAI client.");
    } else if (ts.isCallExpression(node) && openAIAssistantDynamicAccess(node.expression, scopeModel)) {
      addLimitation(node, "Computed or dynamic OpenAI Assistants API access cannot be statically proven.");
    } else if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && openAIAssistantDynamicAccess(node, scopeModel) && !ts.isCallExpression(node.parent)) {
      addLimitation(node, "Computed or dynamic OpenAI Assistants API access cannot be statically proven.");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { matches, limitations };
}

function cloudflareEndpointPath(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "api.cloudflare.com" || url.search || url.hash || !url.pathname.startsWith("/client/v4/")) return null;
  const path = url.pathname.slice("/client/v4".length);
  return /^\/accounts\/[^/?#]+\/workers\/namespaces\/[^/?#]+(?:\/[^/?#]+)*$/.test(path) ? path : null;
}

function isCloudflareEndpoint(value: string): boolean {
  return cloudflareEndpointPath(value) !== null;
}

function isStandaloneCloudflareLiteral(node: ts.StringLiteralLike): boolean {
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) parent = parent.parent;
  return !ts.isBinaryExpression(parent) && !ts.isTemplateExpression(parent) &&
    !(ts.isElementAccessExpression(parent) && parent.argumentExpression === node);
}

function dynamicCloudflareExpression(node: ts.Node): boolean {
  if (!ts.isTemplateExpression(node) && !ts.isBinaryExpression(node) && !ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
  const text = node.getText();
  if (!text.includes(CLOUDFLARE_LEGACY_NAMESPACE_ROUTE_MARKER)) return false;
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return !(node.arguments ?? []).some(argument => ts.isStringLiteralLike(argument) && isCloudflareEndpoint(argument.text));
  }
  return true;
}

function matchesCloudflareSourceFile(file: string, repositoryRoot: string, capabilityChange: CapabilityChange): FileScanResult {
  const content = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, SOURCE_EXTENSIONS.get(extname(file)));
  const matches: CodeMatch[] = [];
  const limitations: AnalysisLimitation[] = [];
  const seen = new Set<string>();
  const addLimitation = (node: ts.Node): void => {
    const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
    const reason = "Computed or dynamic Cloudflare legacy KV endpoint access cannot be statically proven.";
    const key = `${location.file}:${location.line}:${reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      limitations.push({ ...location, reason });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && isStandaloneCloudflareLiteral(node) && isCloudflareEndpoint(node.text)) {
      const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
      matches.push({ vendor: capabilityChange.vendor, capabilityIdentifier: capabilityChange.canonicalIdentifier, ...location, evidenceStrength: "direct", context: contextFor(location.file), evidence: lineEvidence(content, sourceFile, node) });
    }
    if (dynamicCloudflareExpression(node)) addLimitation(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { matches, limitations };
}

function matchesCloudflareConfigFile(file: string, repositoryRoot: string, capabilityChange: CapabilityChange): FileScanResult {
  const content = readFileSync(file, "utf8");
  const matches: CodeMatch[] = [];
  if (extname(file) === ".json") {
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
    const visit = (node: ts.Node): void => {
      const isValue = ts.isStringLiteralLike(node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node);
      if (isValue && isCloudflareEndpoint(node.text)) {
        const location = repositoryLocation(file, repositoryRoot, sourceFile, node);
        matches.push({ vendor: capabilityChange.vendor, capabilityIdentifier: capabilityChange.canonicalIdentifier, ...location, evidenceStrength: "direct", context: contextFor(location.file), evidence: lineEvidence(content, sourceFile, node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  } else {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const value = line.match(/^\s*[^#=]+?\s*=\s*["']([^"']+)["']/)?.[1];
      if (!value || !isCloudflareEndpoint(value)) return;
      matches.push({ vendor: capabilityChange.vendor, capabilityIdentifier: capabilityChange.canonicalIdentifier, file: relative(repositoryRoot, file).replaceAll("\\", "/"), line: index + 1, evidenceStrength: "direct", context: contextFor(relative(repositoryRoot, file)), evidence: line.trim() });
    });
  }
  return { matches, limitations: [] };
}

function matcherFor(capabilityChange: CapabilityChange): CapabilityMatcher {
  if (capabilityChange.vendor === "Slack") return "slack-files-upload";
  if (capabilityChange.vendor === "OpenAI") return "openai-assistants";
  return "cloudflare-kv-legacy-routes";
}

export function scanLocalRepository(repositoryPath: string, notice: VendorNoticeArtifact): ScanArtifact {
  const repositoryRoot = resolve(repositoryPath);
  if (!existsSync(resolve(repositoryRoot, "package.json"))) throw new Error("scan requires one repository root package.json");

  const matcher = matcherFor(notice.capabilityChange);
  const sourceMatcher = matcher === "slack-files-upload" ? matchesSlackFile : matcher === "openai-assistants" ? matchesOpenAIFile : matchesCloudflareSourceFile;
  const sourceResults = repositoryFiles(repositoryRoot, SOURCE_EXTENSIONS).map(file => sourceMatcher(file, repositoryRoot, notice.capabilityChange));
  const configResults = matcher === "cloudflare-kv-legacy-routes"
    ? repositoryFiles(repositoryRoot, CONFIG_EXTENSIONS).map(file => matchesCloudflareConfigFile(file, repositoryRoot, notice.capabilityChange))
    : [];
  const fileResults = [...configResults, ...sourceResults];
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
