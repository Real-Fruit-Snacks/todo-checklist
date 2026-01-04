# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Todo Checklist Pro is a feature-rich task management plugin for Obsidian. It's a vanilla JavaScript project with **no build step** - distributed as three core files: `main.js`, `manifest.json`, and `styles.css`.

## Development Commands

**No build/test/lint commands** - this is a zero-dependency Obsidian plugin with no npm packages.

**To develop:**
1. Edit files directly in your Obsidian vault's `.obsidian/plugins/todo-checklist/` directory
2. Use Obsidian's "Reload app without saving" (Ctrl+R) to see changes
3. Check Obsidian's developer console (Ctrl+Shift+I) for errors

## Architecture

### File Structure
- `main.js` (~3000 lines) - All plugin logic in a single file
- `styles.css` - CSS with variables for light/dark theme compatibility
- `manifest.json` - Obsidian plugin descriptor (v2.5.0)

### Class Hierarchy
```
TodoChecklistPlugin extends Plugin
  └── Manages lifecycle, registers commands and view

TodoChecklistView extends ItemView
  └── Main UI: rendering, state management, keyboard navigation, undo system

Modal Classes (all in main.js):
  ├── TaskEditModal - Full task editor form
  ├── QuickCaptureModal - Fast task entry with natural language parsing
  ├── ListModal - Create/rename projects
  ├── ListSelectorModal - Move tasks between projects
  ├── ConfirmModal - Destructive action confirmation
  ├── NoteSuggestModal - Link Obsidian notes
  └── TodoSettingsModal - Plugin settings
```

### Data Model
```javascript
{
  lists: {
    'list-id': {
      name: string,
      todos: [{ id, text, priority, dueDate, startTime, endTime, allDay,
                recurrence, recurrenceEndDate, tags, subtasks, notes,
                linkedNote, calendarEventPath, createdAt, notified, notified15 }],
      archived: [/* completed tasks */]
    }
  },
  currentList: 'list-id',
  trash: [{action, data}],
  settings: { showArchived, sortBy, notifications, fullCalendarSync, fullCalendarFolder }
}
```

Data persists to `.obsidian/plugins/todo-checklist/data.json` via Obsidian's plugin API.

### Key Code Locations

| Feature | Location in main.js |
|---------|---------------------|
| Constants & Smart lists | `PRIORITIES`, `RECURRENCE_OPTIONS`, `SMART_LISTS` near top |
| Natural language date parsing | `parseNaturalDateTime()` |
| Keyboard navigation (vim-style) | `handleKeyDown()` |
| Undo system | `undoStack`, `undo()` method |
| Full Calendar sync | `syncTaskToCalendar()`, `createCompletedCalendarEvent()`, `buildCalendarFileContent()` |
| Recurring task logic | `getNextRecurrence()` |
| Task rendering | `renderTodoItem()` method |
| Plugin registration | `TodoChecklistPlugin` class at bottom |

### Rendering Pattern
Immediate-mode rendering - every state change triggers full re-render via `render()`. No virtual DOM or incremental updates.

```
User action → Event handler → Modify this.data → saveData() + render()
```

### Keyboard Shortcuts (Vim-style)
- `j/k` or arrows: Navigate tasks
- `x` or space: Complete task
- `e` or enter: Edit task
- `d` or delete: Delete task
- `m`: Move to another list
- `p`: Cycle priority
- `n`: New task input
- `/`: Search
- `gg/G`: Top/bottom
- `Ctrl+Z`: Undo
- `Ctrl+Shift+A`: Global quick capture
- `Esc`: Exit keyboard mode

## Full Calendar Integration

Only **daily** and **weekly** recurrence are synced as recurring calendar events (Full Calendar limitation). These use:
- `type: 'recurring'` with `daysOfWeek`, `startRecur`, `endRecur`
- Day codes must be unquoted in YAML arrays: `[U, M, T, W, R, F, S]`

Non-recurring tasks use `type: 'single'` with `date` and `completed` fields.

When a recurring task is completed:
1. A "completed" single event is created for history tracking
2. The recurring event's `startRecur` advances to the next occurrence
3. If past `recurrenceEndDate`, the recurring calendar file is removed

## Modification Guide

**High-impact areas** (cascading changes):
- `data` structure - affects all load/save/render operations
- `render()` method - affects entire UI
- `getFilteredTodos()` - affects search/filter/sort

**Safe to modify in isolation:**
- Individual modal classes
- Utility functions (`parseNaturalDateTime`, `extractTags`, etc.)
- CSS styles
- Notification checker

**Adding features:**
- New task fields: Update `TaskEditModal`, data model, `renderTodoItem()`
- New smart lists: Add to `SMART_LISTS` object
- New keyboard shortcuts: Add cases to `handleKeyDown()`
- Data migrations: Update `loadData()` with version checks

## Obsidian API Usage

Only dependency:
```javascript
const { Plugin, ItemView, WorkspaceLeaf, Modal, Setting,
        Notice, MarkdownRenderer, FuzzySuggestModal } = require('obsidian');
```

Key patterns:
- Use `createDiv()`, `createEl()` for DOM creation
- Use `Setting` class for forms
- Use `Notice` for user feedback
- Plugin data: `this.plugin.loadData()` / `this.plugin.saveData()`
