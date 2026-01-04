# Todo Checklist Pro for Obsidian

A powerful, feature-rich task management plugin that lives in your Obsidian sidebar. Manage projects, set priorities, track due dates, create subtasks, and stay organized—all without leaving your notes.

## Features

### Task Management
- **Priority levels** (High/Medium/Low) with color-coded indicators
- **Due dates & times** with natural language parsing
- **Recurring tasks** (Daily, Weekly) with optional end dates
- **Subtasks** with progress indicators
- **Notes** with full Markdown support
- **Tags** for categorization and filtering
- **Link to notes** in your vault

### Organization
- **Multiple projects/lists** to organize tasks
- **Smart lists** for automatic filtering:
  - All Tasks
  - Due Today
  - Overdue
  - This Week
  - High Priority
- **Drag-and-drop reordering**
- **Multiple sort options**: Manual, Priority, Due Date, Created

### Keyboard Navigation (Vim-style)
| Key | Action |
|-----|--------|
| `j` / `↓` | Select next task |
| `k` / `↑` | Select previous task |
| `x` / `Space` | Complete selected task |
| `e` / `Enter` | Edit selected task |
| `d` / `Delete` | Delete selected task |
| `m` | Move task to another list |
| `p` | Cycle priority |
| `n` | Focus new task input |
| `/` | Focus search |
| `gg` | Go to first task |
| `G` | Go to last task |
| `Ctrl+Z` | Undo last action |
| `Ctrl+Enter` | Quick add (in input field) |
| `Ctrl+Shift+A` | Global quick capture |
| `Esc` | Exit keyboard navigation |

### Due Dates & Times
Natural language parsing supports:
- `tomorrow at 3pm`
- `monday 9:00`
- `next friday at 14:30`
- `in 3 days`

Tasks with specific times get 15-minute reminder notifications. Overdue tasks are highlighted.

### Recurring Tasks
- **Daily** - repeats every day
- **Weekly** - repeats on the same day each week
- **End date** - optionally set when recurrence should stop

When you complete a recurring task:
1. The completed instance moves to the archive
2. A new task is created with the next due date
3. Subtasks reset to incomplete
4. A notification shows the new due date

If an end date is set and reached, the recurring series ends automatically.

### Full Calendar Integration
Sync tasks with the [Full Calendar](https://github.com/obsidian-community/obsidian-full-calendar) plugin.

**Setup:**
1. Install Full Calendar from Community Plugins
2. Open Todo Checklist settings (gear icon in sidebar)
3. Enable "Calendar sync"
4. Set your preferred folder (default: `calendar/tasks`)
5. Click "Sync All" to sync existing tasks
6. In Full Calendar settings, add a Local calendar pointing to the same folder

**How it works:**
- Tasks with due dates create markdown event files
- **Single tasks** appear on their due date
- **Daily/Weekly recurring tasks** appear on all scheduled days for planning
- Completing a recurring task creates a "done" marker on that date while keeping future occurrences visible
- Deleting a task removes its calendar event

**Project colors:**
- Right-click a project → Edit → assign a color
- Each colored project becomes a separate calendar in Full Calendar
- Tasks inherit their project's color in the calendar view
- Use "Sync All" in settings after changing colors (reload Obsidian to see changes)

**Supported recurrence for calendar sync:**
Only Daily and Weekly recurring tasks sync as recurring calendar events (Full Calendar limitation). These show on all applicable future dates so you can plan ahead.

### Search & Filter
- **Full-text search** with highlighting
- **Filter by tag** - click any tag in the sidebar
- **Sidebar search** to filter projects and lists
- Search works across active and completed tasks

### Undo System
- Undo add, delete, complete, move, edit, and clear actions
- Access via sidebar button or `Ctrl+Z`
- Up to 50 actions stored in memory per session
- Confirmation dialogs for destructive actions

### Global Quick Capture
Press `Ctrl+Shift+A` from anywhere in Obsidian to quickly add a task. Automatically parses dates, times, and tags.

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to **Community Plugins** and disable Safe Mode
3. Click **Browse** and search for "Todo Checklist Pro"
4. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Real-Fruit-Snacks/todo-checklist/releases/latest)
2. Create a folder named `todo-checklist` in your vault's `.obsidian/plugins/` directory
3. Place the downloaded files in this folder
4. Reload Obsidian and enable the plugin in **Settings → Community Plugins**

## Usage

### Opening the Plugin
- Click the **checkbox icon** in the left ribbon
- Command Palette: `Open Todo Checklist`
- Command Palette: `Quick add todo`

### Adding Tasks

**Quick Add (Ctrl+Enter):**
Type in the input field and press `Ctrl+Enter`. Automatically parses:
- Dates: `Buy groceries tomorrow`
- Tags: `Finish report #work #urgent`

**Detailed Add (Enter):**
Press `Enter` to open the full task editor with all options:
- Task name
- Priority level
- Due date and time
- Recurrence (Daily/Weekly) with optional end date
- Notes (Markdown supported)
- Subtasks

### Managing Tasks

- **Complete**: Click the checkbox
- **Edit**: Click the pencil icon (or press `e`)
- **Priority**: Click the flag icon to cycle (or press `p`)
- **Delete**: Click the trash icon (or press `d`)
- **Reorder**: Drag using the grip handle
- **Link to note**: Click the file icon
- **Expand**: Click the arrow to see notes and subtasks

### Using the Sidebar

**Smart Lists:** Auto-filtered views of your tasks

**Projects:** Your custom lists
- Click to switch between projects
- Click `+` to create new projects
- Right-click to rename or delete

**Tags:** Click any tag to filter

**Settings:** Gear icon for plugin configuration

**Undo:** Shows when actions can be undone

## Data Structure

Tasks are stored in `.obsidian/plugins/todo-checklist/data.json`:

```javascript
{
  lists: {
    'list-id': {
      name: 'Project Name',
      color: '#hex|null',  // For calendar integration
      todos: [{
        id: 'unique-id',
        text: 'Task description',
        priority: 'high|medium|low|none',
        dueDate: 'ISO date string',
        startTime: '09:00',
        endTime: '10:00',
        allDay: true|false,
        recurrence: 'daily|weekly|null',
        recurrenceEndDate: 'ISO date string|null',
        tags: ['#tag1', '#tag2'],
        subtasks: [{ id, text, completed }],
        notes: 'Markdown notes',
        linkedNote: 'path/to/note.md',
        calendarEventPath: 'calendar/tasks/event.md',
        createdAt: timestamp,
        notified: false,
        notified15: false
      }],
      archived: [/* completed tasks */]
    }
  },
  currentList: 'list-id',
  settings: {
    showArchived: false,
    sortBy: 'manual|priority|dueDate|created',
    notifications: true,
    fullCalendarSync: false,
    fullCalendarFolder: 'calendar/tasks'
  }
}
```

Note: Undo history is kept in memory during the session (up to 50 actions) and is not persisted to disk.

## Customization

The plugin respects your Obsidian theme:
- Light and dark themes
- Custom accent colors
- Reduced motion preferences
- High contrast mode

### CSS Classes
- `.todo-checklist-container` - main container
- `.todo-sidebar` - left sidebar
- `.todo-item` - individual tasks
- `.todo-item.priority-high` - high priority
- `.todo-item.priority-medium` - medium priority
- `.todo-item.priority-low` - low priority
- `.todo-item.overdue` - overdue tasks
- `.todo-item.keyboard-selected` - keyboard nav highlight

## Mobile Support

This plugin is currently **desktop-only**. The plugin requires keyboard navigation and desktop-specific interactions that don't translate well to mobile devices. Mobile support may be considered for future versions.

## FAQ

**Where is my data stored?**
In your vault at `.obsidian/plugins/todo-checklist/data.json`

**Can I sync between devices?**
Yes - the data file syncs with your vault (Obsidian Sync, iCloud, etc.)

**How do I backup my tasks?**
Include `data.json` in your vault backups

**Why only Daily and Weekly recurrence?**
Full Calendar only supports these patterns natively. Other intervals would only appear as single events on the calendar.

## Troubleshooting

**Tasks not saving:**
- Check the developer console (Ctrl+Shift+I) for errors

**Calendar events not appearing:**
- Verify Full Calendar is installed and configured
- Check the calendar folder path matches in both plugins
- Reload Obsidian after enabling calendar sync

**Notifications not working:**
- Enable notifications in plugin settings
- Check system notification permissions for Obsidian

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

Made for the Obsidian community
