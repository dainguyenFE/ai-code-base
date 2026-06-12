import {
  buildDataTraceChain,
  buildEnrichedLinearPropFlowGraph,
  buildUiTree,
} from "@cs/page-logic-visualizer/server";
import type { PageLogicGraph } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

const resolveFieldPathFromChain = (
  chain: ReturnType<typeof buildDataTraceChain>,
  variableName: string
): string | undefined => {
  const propStep = chain.steps.find(
    (step) => step.stepRole === "prop" && step.label !== variableName
  );
  if (propStep) {
    const { label } = propStep;
    return label.includes(".")
      ? label.split(".").slice(1).join(".") || label
      : label;
  }

  const upstreamVariable = chain.steps.find(
    (step) =>
      step.stepRole === "variable" &&
      step.label !== variableName &&
      step.label !== "data"
  );
  if (upstreamVariable) {
    return upstreamVariable.label;
  }

  return undefined;
};

export async function POST(request: Request) {
  const config = await getServerProjectConfig();
  const body = (await request.json()) as {
    graph: PageLogicGraph;
    consumerNodeId: string;
    variableName: string;
  };

  try {
    if (!body.consumerNodeId || !body.variableName) {
      return NextResponse.json(
        { error: "consumerNodeId and variableName are required" },
        { status: 400 }
      );
    }

    const uiTree = buildUiTree(body.graph);
    const sourceChain = buildDataTraceChain(
      body.graph,
      body.variableName,
      body.consumerNodeId,
      uiTree
    );
    const fieldPath = resolveFieldPathFromChain(sourceChain, body.variableName);

    const flowNodes = buildEnrichedLinearPropFlowGraph(
      body.graph,
      sourceChain,
      {
        consumerNodeId: body.consumerNodeId,
        fieldPath,
        rootDir: config.rootDir,
        variableName: body.variableName,
      }
    );

    return NextResponse.json({ flowNodes, sourceChain });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Variable trace failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
