import { create } from "zustand";

export interface WorkspaceLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface WorkspaceState {
  activeLayerId: string | null;
  layers: WorkspaceLayer[];
  selectedTool: "select" | "brush" | "text" | "shape";
  zoom: number;
  addLayer: (name: string) => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string | null) => void;
  selectTool: (tool: WorkspaceState["selectedTool"]) => void;
  setZoom: (zoom: number) => void;
  toggleLayerLock: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
}

const DEFAULT_LAYERS: WorkspaceLayer[] = [
  { id: "layer-bg", locked: false, name: "Background", visible: true },
  { id: "layer-main", locked: false, name: "Main", visible: true },
];

/** Level 7 — Zustand store for workspace state */
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeLayerId: "layer-main",
  addLayer: (name) => {
    const id = `layer-${Date.now()}`;
    set((state) => ({
      activeLayerId: id,
      layers: [...state.layers, { id, locked: false, name, visible: true }],
    }));
  },
  layers: DEFAULT_LAYERS,
  removeLayer: (id) => {
    const { activeLayerId, layers } = get();
    const next = layers.filter((layer) => layer.id !== id);
    set({
      activeLayerId:
        activeLayerId === id ? (next[0]?.id ?? null) : activeLayerId,
      layers: next,
    });
  },
  selectLayer: (id) => set({ activeLayerId: id }),
  selectTool: (tool) => set({ selectedTool: tool }),
  selectedTool: "select",
  setZoom: (zoom) => set({ zoom: Math.min(400, Math.max(25, zoom)) }),
  toggleLayerLock: (id) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === id ? { ...layer, locked: !layer.locked } : layer
      ),
    })),
  toggleLayerVisibility: (id) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === id ? { ...layer, visible: !layer.visible } : layer
      ),
    })),
  zoom: 100,
}));
