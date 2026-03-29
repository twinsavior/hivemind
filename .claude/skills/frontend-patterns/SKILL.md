---
name: frontend-patterns
description: Universal frontend patterns and gotchas -- React, TypeScript, TanStack Query, Tailwind. Auto-loads when working on frontend code.
user-invocable: false
---

# Universal Frontend Patterns

## React + TypeScript

### TanStack Query
- Queries are the source of truth. Don't duplicate API data in useState.
- `onSuccess` invalidations in mutations can miss components that aren't mounted yet (see AnimatePresence gotcha).
- Optimistic updates: `queryClient.setQueryData()` in `onMutate`, rollback in `onError`.

### Radix UI / Headless Components
- Controlled vs uncontrolled: Radix components can be either. Pick one and be consistent per component.
- `forceMount` on `CommandGroup` + `CommandItem` (cmdk) prevents built-in filtering from hiding items.
- Radix Dialog renders on top of Sheet naturally (DOM order). No z-index hacking.

### React 19 Types
- `useRef()` requires an initial value: `useRef<HTMLDivElement>(null)`.
- `unknown` in metadata: Use ternary `? <el> : null` with `String()`, NOT `&&` (short-circuits to `unknown`, invalid ReactNode).

## Tailwind CSS

### Flex Layout Gotchas
- `min-w-0` on every flex ancestor to enable horizontal scroll on children.
- `overflow-hidden` on the outermost flex container if children have `overflow-x-auto`.
- `flex-1` + `w-full` can conflict in sidebar layouts. Prefer `flex-1 min-w-0`.

### Responsive Patterns
- Mobile-first: `p-4 sm:p-6` (tighter on mobile, roomier on desktop).
- Hide elements below breakpoint: `hidden sm:block`.
- Progressive disclosure: Move secondary actions to overflow menu below breakpoint.

## Date Handling (Critical)

```js
// Date-only strings → append T00:00:00 for local time
new Date('2026-03-03T00:00:00')  // March 3 in any timezone

// Full ISO datetimes → use as-is
new Date('2026-03-03T14:30:00Z') // Don't double-append

// Document timestamps from DB → already full ISO, don't append
```

## Form Patterns

- Debounce search inputs: 300ms for local filtering, 500ms for API calls.
- `parse_qs` (Python backend) returns arrays: `params.get('key')` gives `['value']` not `'value'`.
- File uploads: JSON + base64 is simpler than multipart for small files (<15MB).
