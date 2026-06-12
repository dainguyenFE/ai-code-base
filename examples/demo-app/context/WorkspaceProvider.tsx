"use client";

import { createContext, use, useCallback, useMemo } from "react";
import type { ReactNode } from "react";

import { useWorkspaceStore } from "../stores/useWorkspaceStore";

export interface WorkspaceContextValue {
  locale: string;
  projectId: string | null;
  projectName: string;
  isSaving: boolean;
  markSaving: (value: boolean) => void;
  resetWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
  locale: string;
  projectId?: string | null;
  projectName?: string;
}

/** Level 7 — React context wrapping Zustand + route metadata */
export function WorkspaceProvider({
  children,
  locale,
  projectId = null,
  projectName = "Untitled",
}: WorkspaceProviderProps) {
  const resetStore = useWorkspaceStore((state) => state.selectTool);

  const resetWorkspace = useCallback(() => {
    resetStore("select");
    useWorkspaceStore.setState({ activeLayerId: "layer-main", zoom: 100 });
  }, [resetStore]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      isSaving: false,
      locale,
      markSaving: () => {},
      projectId,
      projectName,
      resetWorkspace,
    }),
    [locale, projectId, projectName, resetWorkspace]
  );

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = use(WorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceContext must be used within WorkspaceProvider"
    );
  }
  return ctx;
}
