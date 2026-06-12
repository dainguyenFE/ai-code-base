import type {
  BranchRecord,
  ExecutionStepRecord,
  RenderSiteRecord,
} from "@ai-trace/types";
import { Node } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";

import { isHookName, isPascalCase } from "./utils.js";

function clip(text: string, max = 80): string {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function collectRenderSites(bodyNode: MorphNode): RenderSiteRecord[] {
  const sites: RenderSiteRecord[] = [];
  const seen = new Set<string>();

  bodyNode.forEachDescendant((child) => {
    if (
      !Node.isJsxOpeningElement(child) &&
      !Node.isJsxSelfClosingElement(child)
    ) {
      return;
    }

    const tag = child.getTagNameNode().getText();
    if (!isPascalCase(tag)) {
      return;
    }

    const line = child.getStartLineNumber();
    const key = `${line}:${tag}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    sites.push({
      component: tag,
      expression: clip(child.getText(), 120),
      line,
    });
  });

  return [...sites].toSorted((a, b) => a.line - b.line);
}

export function collectBranchSites(bodyNode: MorphNode): BranchRecord[] {
  const branches: BranchRecord[] = [];
  const seen = new Set<string>();

  bodyNode.forEachDescendant((child) => {
    if (Node.isIfStatement(child)) {
      const line = child.getStartLineNumber();
      const key = `if:${line}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      const condition = clip(child.getExpression().getText());
      const thenStmt = child.getThenStatement();
      const thenReturn =
        Node.isReturnStatement(thenStmt) ||
        (Node.isBlock(thenStmt) &&
          thenStmt
            .getStatements()
            .some((stmt) => Node.isReturnStatement(stmt)));

      branches.push({
        branchKind: thenReturn ? "early_return" : "if",
        condition,
        line,
      });
      return;
    }

    if (Node.isConditionalExpression(child)) {
      const line = child.getStartLineNumber();
      const key = `ternary:${line}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      branches.push({
        branchKind: "ternary",
        condition: clip(child.getCondition().getText()),
        line,
      });
    }
  });

  return [...branches].toSorted((a, b) => a.line - b.line);
}

interface RawStep {
  kind: ExecutionStepRecord["kind"];
  line: number;
  target?: string;
  label: string;
  expression?: string;
  branchKind?: BranchRecord["branchKind"];
  condition?: string;
}

export function buildExecutionSteps(
  bodyNode: MorphNode
): ExecutionStepRecord[] {
  const raw: RawStep[] = [];

  bodyNode.forEachDescendant((child) => {
    if (!Node.isCallExpression(child)) {
      return;
    }

    const expr = child.getExpression();
    let callee: string;

    if (Node.isIdentifier(expr)) {
      callee = expr.getText();
    } else if (Node.isPropertyAccessExpression(expr)) {
      callee = `${expr.getExpression().getText()}.${expr.getName()}`;
    } else {
      return;
    }

    if (isHookName(callee.split(".")[0] ?? callee)) {
      raw.push({
        expression: clip(child.getText(), 100),
        kind: "hook",
        label: callee,
        line: child.getStartLineNumber(),
        target: callee.split(".")[0] ?? callee,
      });
      return;
    }

    raw.push({
      expression: clip(child.getText(), 100),
      kind: "call",
      label: callee,
      line: child.getStartLineNumber(),
      target: callee.split(".")[0] ?? callee,
    });
  });

  for (const site of collectRenderSites(bodyNode)) {
    raw.push({
      expression: site.expression,
      kind: "render",
      label: site.component,
      line: site.line,
      target: site.component,
    });
  }

  for (const branch of collectBranchSites(bodyNode)) {
    raw.push({
      branchKind: branch.branchKind,
      condition: branch.condition,
      kind: "branch",
      label:
        branch.branchKind === "early_return"
          ? `if (${branch.condition}) → return`
          : `if (${branch.condition})`,
      line: branch.line,
    });
  }

  raw.sort((a, b) => {
    if (a.line !== b.line) {
      return a.line - b.line;
    }

    const kindOrder: Record<ExecutionStepRecord["kind"], number> = {
      branch: 0,
      call: 1,
      hook: 2,
      render: 3,
      return: 4,
    };

    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  return raw.map((step, index) => ({
    branchKind: step.branchKind,
    condition: step.condition,
    expression: step.expression,
    kind: step.kind,
    label: step.label,
    line: step.line,
    order: index + 1,
    target: step.target,
  }));
}

/** @deprecated Use collectRenderSites — keeps render name list for graph compat. */
export function collectRendersFromSites(sites: RenderSiteRecord[]): string[] {
  return [...new Set(sites.map((site) => site.component))];
}
