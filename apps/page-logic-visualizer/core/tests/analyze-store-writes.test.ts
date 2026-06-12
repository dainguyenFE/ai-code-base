import { describe, expect, it } from "bun:test";

import { Project } from "ts-morph";

import {
  analyzeStoreFieldEffectDeps,
  analyzeStoreWritesInBody,
  setterNameForField,
} from "../src/analyzer/analyzeStoreWrites";

describe("analyzeStoreWrites", () => {
  it("derives setter name from field", () => {
    expect(setterNameForField("sidebarOpen")).toBe("setSidebarOpen");
  });

  it("finds setSidebarOpen in component body", () => {
    const project = new Project({ useInMemoryFileOnly: true });
    const source = project.createSourceFile(
      "DemoHeader.tsx",
      `
      export function DemoHeader() {
        const { setSidebarOpen, sidebarOpen } = useDemoUiStore();
        return (
          <button onClick={() => setSidebarOpen(!sidebarOpen)} type="button">
            Toggle
          </button>
        );
      }
      `
    );

    const fn = source.getFunctionOrThrow("DemoHeader");
    const writes = analyzeStoreWritesInBody({
      body: fn.getBody()!,
      filePath: "DemoHeader.tsx",
      ownerLabel: "DemoHeader",
      storeField: "sidebarOpen",
    });

    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0]?.context).toBe("event-handler");
    expect(writes[0]?.expression).toContain("setSidebarOpen");
  });

  it("finds useEffect deps on store field", () => {
    const project = new Project({ useInMemoryFileOnly: true });
    const source = project.createSourceFile(
      "useLivePricingData.ts",
      `
      export function useLivePricingData() {
        const { sidebarOpen } = useDemoUiStore();
        useEffect(() => {
          void load();
        }, [sidebarOpen]);
      }
      `
    );

    const fn = source.getFunctionOrThrow("useLivePricingData");
    const triggers = analyzeStoreFieldEffectDeps({
      body: fn.getBody()!,
      filePath: "useLivePricingData.ts",
      ownerLabel: "useLivePricingData",
      storeField: "sidebarOpen",
    });

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.context).toBe("effect-deps");
    expect(triggers[0]?.effectDeps).toContain("sidebarOpen");
  });
});
