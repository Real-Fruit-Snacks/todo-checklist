# Todo Checklist Pro - Fix Changelog

This document tracks all fixes applied to resolve issues identified in `plugin_analysis_report.md`.

**Version:** 2.5.1
**Date:** 2026-01-03

---

## Phase 1: Critical Fixes (8 fixes applied)

### Fix 1.1: Track keyComboTimeout for cleanup
**Location:** main.js:618
**Issue:** Timeout not stored, preventing cleanup on view close
**Fix:** Store timeout reference as `this.keyComboTimeout` and clear existing before setting new one

### Fix 1.2: Fix onClose cleanup
**Location:** main.js:456-496
**Issue:** Incomplete cleanup causing memory leaks
**Fix:** Added cleanup for:
- `keyComboTimeout` - clear and null
- `searchTimeout` - clear and null
- `_archivingIds` - clear Set and null
- `_tagsCache` - null
- `expandedTasks` - clear Set
- `undoStack` - empty array
- `notificationInterval` - clear and null

### Fix 1.3: Make searchTimeout a class property
**Location:** main.js:1387-1405
**Issue:** Local variable prevents cleanup
**Fix:** Changed `let searchTimeout` to use `this.searchTimeout` throughout

### Fix 1.4: Fix race condition in undo - _archivingIds
**Location:** main.js:666
**Issue:** Potential crash if _archivingIds is undefined
**Fix:** Use optional chaining: `this._archivingIds?.size > 0`

### Fix 1.5: Fix sortTodos array mutation
**Location:** main.js:1149-1169
**Issue:** Mutates original array, causing unexpected side effects
**Fix:** Create copy with `const sortedTodos = [...todos]` before sorting

### Fix 1.6: Use deep clone in undo operations
**Location:** main.js:1962, 2072, 2102, 2257
**Issue:** Shallow spread `{ ...todo }` doesn't clone nested objects like subtasks
**Fix:** Use `this.cloneTask(todo)` for proper deep cloning in all undo pushes

### Fix 1.7: Add mobile platform detection
**Location:** main.js:1, 449-457, 515-519
**Fix:**
- Import `Platform` from obsidian
- Add `get isMobile()` getter
- Add `get isTouchDevice()` getter
- Skip keyboard shortcuts on mobile

### Fix 1.8: Disable drag/drop on touch devices
**Location:** main.js:1693-1709
**Issue:** Drag events conflict with touch scrolling
**Fix:** Check `!this.isTouchDevice` before enabling drag listeners and draggable attribute

---

## Phase 2: High Priority Fixes (10 fixes applied)

### Fix 2.1: Batch saveData in checkDueTasks
**Location:** main.js:871-901
**Issue:** Multiple fire-and-forget saves in notification loop
**Fix:** Track `needsSave` flag and call `this.saveData()` once at end

### Fix 2.2: Validate target list in moveTaskToList
**Location:** main.js:2237-2259
**Issue:** Missing null check for source/target lists
**Fix:** Add validation `if (!sourceList || !targetList) { new Notice('Error: List not found'); return; }`

### Fix 2.3: Add null checks to file event handlers
**Location:** main.js:3778-3796
**Issue:** File events may receive null/undefined file
**Fix:** Add guards `if (file && file.path && oldPath)` and `if (file && file.path)`

### Fix 2.4: Path traversal validation for calendar folder
**Location:** main.js:74-84, 2313-2318
**Issue:** User could set calendar folder to `../` path
**Fix:** Add `validatePath()` helper function that rejects:
- Absolute paths
- Parent directory references (`..`)
- Control characters

### Fix 2.5: Update minAppVersion in manifest
**Location:** manifest.json:5
**Fix:** Changed `"minAppVersion": "1.0.0"` to `"1.2.0"` (API features used)

### Fix 2.6: Set isDesktopOnly in manifest
**Location:** manifest.json:9
**Fix:** Changed `"isDesktopOnly": false` to `true` until mobile support is complete

### Fix 2.7: Bump version in manifest
**Location:** manifest.json:4
**Fix:** Changed version to `"2.5.1"` to reflect fixes

### Fix 2.8: Fix action buttons visibility on touch devices
**Location:** styles.css:1664-1703
**Fix:** Added `@media (pointer: coarse)` with `.todo-actions { opacity: 1; }`

### Fix 2.9: Fix accessibility colors - CSS variables
**Location:** styles.css:1717-1765
**Fix:** Added CSS custom properties for priority colors:
- `--todo-priority-high`
- `--todo-priority-medium`
- `--todo-priority-low`
- Different values for dark theme

### Fix 2.10: Add touch target sizes
**Location:** styles.css:1670-1702
**Fix:** Set `min-width: 44px; min-height: 44px` for buttons per WCAG guidelines

---

## Phase 3: Medium Priority Fixes (7 fixes applied)

### Fix 3.1: Validate dates in formatDateTime
**Location:** main.js:286-291
**Issue:** No check for invalid date
**Fix:** Added `if (isNaN(date.getTime())) return '';`

### Fix 3.2: Add tag search to archived filter
**Location:** main.js:1137-1143
**Issue:** Archived search didn't include tags
**Fix:** Added `|| (t.tags || []).some(tag => tag.toLowerCase().includes(query))`

### Fix 3.3: Add null guard to renderTodoItem
**Location:** main.js:1686-1691
**Issue:** Could crash on invalid todo object
**Fix:** Added guard `if (!todo || !todo.id) { console.warn(...); return; }`

### Fix 3.4: Validate startTime in getDefaultEndTime
**Location:** main.js:2574-2584
**Issue:** No validation of input format
**Fix:** Added validation for string type, colon split, and NaN checks

### Fix 3.5: Add smart list validation
**Location:** main.js:1096-1103
**Issue:** Invalid smart list key could crash filter
**Fix:** Validate `SMART_LISTS[this.currentSmartList]` exists with fallback

### Fix 3.6: Add focus states for more elements
**Location:** styles.css:1705-1715
**Fix:** Added `:focus-visible` styles for sort-item, filter-chip, expand-btn, etc.

### Fix 3.7: Add Firefox scrollbar support
**Location:** styles.css:1654-1659
**Fix:** Added `scrollbar-width: thin` and `scrollbar-color` for Firefox

---

## Phase 4: Low Priority Fixes (4 fixes applied)

### Fix 4.1: Replace deprecated substr
**Location:** main.js:373
**Issue:** `.substr()` is deprecated
**Fix:** Changed `.substr(2)` to `.slice(2)`

### Fix 4.2: Explicit radix in parseInt
**Location:** main.js:171, 172, 205, 234
**Issue:** Missing radix parameter (defaults to 10 but lint warning)
**Fix:** Added `, 10` to all `parseInt()` calls

### Fix 4.3: Hide drag handle on touch devices
**Location:** styles.css:1699-1702
**Fix:** Added `.todo-drag-handle { display: none; }` in touch media query

### Fix 4.4: Priority color theming for dark mode
**Location:** styles.css:1726-1730
**Fix:** Added `.theme-dark` overrides with slightly lighter priority colors

---

## Fixes Applied During Verification Audit

### Fix V.1: expandedTasks Cleanup Consistency
**Location:** main.js:511-514
**Issue:** expandedTasks was cleared but not nulled, inconsistent with other cleanup patterns
**Fix:** Added `this.expandedTasks = null` after `.clear()`

### Fix V.2: State Re-initialization in onOpen
**Location:** main.js:475-479
**Issue:** After nulling state in onClose, state wasn't re-initialized on view reopen
**Fix:** Added re-initialization for expandedTasks and undoStack in onOpen()

---

## Summary

| Phase | Category | Issues Fixed |
|-------|----------|--------------|
| 1 | Critical | 8 |
| 2 | High | 10 |
| 3 | Medium | 7 |
| 4 | Low | 4 |
| Verification | Additional | 2 |
| 5 | Event Delegation | 1 |
| **Total** | | **32** |

### Files Modified

1. **main.js** - Core plugin logic
   - Added Platform import for mobile detection
   - Added validatePath() helper function
   - Fixed memory leaks in onClose()
   - Added input validation throughout
   - **Added event delegation pattern** (registerEventDelegation, handleDelegatedClick, etc.)
   - Fixed array mutation in sortTodos
   - Deep cloning for undo operations
   - Mobile/touch device detection

2. **styles.css** - Styling
   - Touch device media queries
   - Priority color CSS variables
   - Focus state improvements
   - Firefox scrollbar support
   - Touch target sizing (44px minimum)

3. **manifest.json** - Plugin metadata
   - Version: 2.5.0 -> 2.5.1
   - minAppVersion: 1.0.0 -> 1.2.0
   - isDesktopOnly: false -> true

---

## Phase 5: Event Delegation Fix (1 fix applied)

### Fix 5.1: Implement Event Delegation Pattern
**Location:** main.js:552-625, 487-512, 1506-1637, 1647-1757, 1906-2103
**Issue:** Per-element event listeners causing potential memory accumulation (Issues 6.1-6.4)
**Fix:** Implemented comprehensive event delegation pattern:

**New Methods Added:**
- `registerEventDelegation()` - Registers 4 delegated handlers (click, change, input, keydown)
- `handleDelegatedClick(e)` - Single click handler using data-action attributes
- `handleDelegatedChange(e)` - Checkbox change handler via delegation
- `handleDelegatedInput(e)` - Input handler for search with debouncing
- `handleDelegatedKeydown(e)` - Keydown for subtask input, search input, task input

**Updated in onClose():**
- Cleanup for `boundClickHandler`, `boundChangeHandler`, `boundInputHandler`, `boundKeydownDelegatedHandler`

**Updated Render Methods:**
- `renderTodoItem()` - Uses data-action, data-task-id, data-parent-id attributes
- `renderSidebar()` - Uses data-action, data-smart-list, data-list-id, data-tag attributes
- `renderHeader()` - Uses data-action, data-sort-value attributes
- `renderActiveFilters()` - Uses data-action attributes
- `renderInputSection()` - Uses data-action attributes
- `renderArchivedSection()` - Uses data-action attributes

**Action Types Supported:**
- Task: edit, priority, link, move, delete, delete-subtask, delete-archived, expand, open-linked-note
- Sidebar: select-smart-list, select-list, select-tag, add-list, open-settings, undo
- Header: clear-search, set-sort, clear-filter-tag, clear-filter-search
- Input: add-task
- Archived: toggle-archived, clear-archived

**Notes:**
- Drag/drop and context menu remain per-element (complex behaviors)
- Sidebar filter remains local (operates on DOM visibility, not data)

---

## Remaining Issues (Acknowledged)

Some issues from the original analysis were not addressed in this pass:

- **Data migration system** - Recommended for future major version changes
- **Parallel calendar sync** - Current sequential sync is more reliable for error handling
- **Settings validation for fullCalendarFolder** - Path validation added, but settings UI validation deferred
- **JSDoc comments** - Code quality improvement, not a bug fix

These can be addressed in a future update if needed.

---

*Generated: 2026-01-03*
*Updated: 2026-01-03 - Added Event Delegation Fix (Phase 5)*
