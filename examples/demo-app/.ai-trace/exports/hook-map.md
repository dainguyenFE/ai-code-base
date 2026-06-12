# Hook Map

## useWorkspaceContext

File:

- context/WorkspaceProvider.tsx

Calls:

- use

## useCounter

File:

- hooks/useCounter.ts

Calls:

- useState
- useToggle
- useCallback
- setCount

Uses hooks:

- useState
- useToggle
- useCallback

## useDashboardData

File:

- hooks/useDashboardData.ts

Calls:

- getStats
- useCounter
- useToggle

Uses hooks:

- useCounter
- useToggle

## useDebouncedValue

File:

- hooks/useDebouncedValue.ts

Calls:

- useState
- useEffect
- setTimeout
- setDebounced
- clearTimeout

Uses hooks:

- useState
- useEffect

## useIsMobile

File:

- hooks/useIsMobile.ts

Calls:

- useState
- useEffect
- window.matchMedia
- window
- setIsMobile
- onChange
- media.addEventListener
- media
- media.removeEventListener

Uses hooks:

- useState
- useEffect

## useKeyboardShortcuts

File:

- hooks/useKeyboardShortcuts.ts

Calls:

- useWorkspaceStore
- useLayerSelection
- useRef
- useEffect
- event.preventDefault
- event
- selectNext
- selectPrevious
- setZoom
- window.addEventListener
- window
- window.removeEventListener

Uses hooks:

- useWorkspaceStore
- useLayerSelection
- useRef
- useEffect

## useLayerSelection

File:

- hooks/useLayerSelection.ts

Calls:

- useWorkspaceStore
- useMemo
- layers.find
- layers
- layers.filter
- useCallback
- layers.findIndex
- selectLayer

Uses hooks:

- useWorkspaceStore
- useMemo
- useCallback

## useRelatedPosts

File:

- hooks/useRelatedPosts.ts

Calls:

- getBlogDetail

## useToggle

File:

- hooks/useToggle.ts

Calls:

- useState
- useCallback
- setOn

Uses hooks:

- useState
- useCallback

## useWorkspace

File:

- hooks/useWorkspace.ts

Calls:

- useWorkspaceContext
- useIsMobile
- useLayerSelection
- useWorkspaceStore
- useDebouncedValue
- useKeyboardShortcuts
- useMemo

Uses hooks:

- useWorkspaceContext
- useIsMobile
- useLayerSelection
- useWorkspaceStore
- useDebouncedValue
- useKeyboardShortcuts
- useMemo
