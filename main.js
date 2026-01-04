const { Plugin, ItemView, WorkspaceLeaf, Modal, Setting, Notice, MarkdownRenderer, FuzzySuggestModal, Menu, PluginSettingTab, Platform } = require('obsidian');

const VIEW_TYPE_TODO = 'todo-checklist-view';

// Note Suggester Modal
class NoteSuggestModal extends FuzzySuggestModal {
    constructor(app, onSelect) {
        super(app);
        this.onSelect = onSelect;
    }
    getItems() {
        return this.app.vault.getMarkdownFiles();
    }
    getItemText(item) {
        return item.path;
    }
    onChooseItem(item, evt) {
        this.onSelect(item);
    }
}

// List Selector Modal for moving tasks
class ListSelectorModal extends FuzzySuggestModal {
    constructor(app, lists, currentListId, onSelect) {
        super(app);
        this.lists = lists;
        this.currentListId = currentListId;
        this.onSelect = onSelect;
    }
    getItems() {
        return Object.entries(this.lists)
            .filter(([id]) => id !== this.currentListId)
            .map(([id, list]) => ({ id, name: list.name }));
    }
    getItemText(item) {
        return item.name;
    }
    onChooseItem(item, evt) {
        this.onSelect(item.id);
    }
}

// Priority configuration
const PRIORITIES = {
    high: { label: 'High', color: '#e53935', icon: '🔴', sort: 1 },
    medium: { label: 'Medium', color: '#fb8c00', icon: '🟡', sort: 2 },
    low: { label: 'Low', color: '#43a047', icon: '🟢', sort: 3 },
    none: { label: 'None', color: 'var(--text-muted)', icon: '⚪', sort: 4 }
};

// Recurrence options
const RECURRENCE_OPTIONS = {
    none: { label: 'No repeat', value: null },
    daily: { label: 'Daily', value: 'daily' },
    weekly: { label: 'Weekly', value: 'weekly' }
};

// Project color options for calendar integration
const PROJECT_COLORS = [
    { name: 'Default', value: null },
    { name: 'Red', value: '#e53935' },
    { name: 'Orange', value: '#fb8c00' },
    { name: 'Yellow', value: '#fdd835' },
    { name: 'Green', value: '#43a047' },
    { name: 'Teal', value: '#00897b' },
    { name: 'Blue', value: '#1e88e5' },
    { name: 'Indigo', value: '#5e35b1' },
    { name: 'Purple', value: '#8e24aa' },
    { name: 'Pink', value: '#d81b60' },
    { name: 'Brown', value: '#6d4c41' },
    { name: 'Gray', value: '#757575' }
];

// Validate path to prevent directory traversal attacks
function validatePath(path) {
    if (!path || typeof path !== 'string') return false;
    // Reject absolute paths
    if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
    // Reject parent directory references
    if (path.includes('..')) return false;
    // Reject paths with null bytes or other control characters
    if (/[\x00-\x1f]/.test(path)) return false;
    return true;
}

// Configuration constants
const CONFIG = {
    DEBOUNCE_SAVE_MS: 150,
    KEY_COMBO_TIMEOUT_MS: 500,
    ANIMATION_DURATION_MS: 300,
    MAX_TASK_TEXT_LENGTH: 10000,
    MAX_TASK_NOTES_LENGTH: 50000,
    MAX_SUBTASK_TEXT_LENGTH: 1000,
    MAX_LIST_NAME_LENGTH: 100,
    MAX_UNDO_STACK_SIZE: 50,
    NOTIFICATION_CHECK_INTERVAL_MS: 60000
};

// Default settings - single source of truth
const DEFAULT_SETTINGS = {
    showArchived: false,
    sortBy: 'manual',
    notifications: true,
    fullCalendarSync: false,
    fullCalendarFolder: 'calendar/tasks',
    enableConfirmDialogs: true,
    enableAnimations: true,
    enableKeyboardNavigation: true,
    enableQuickCapture: true
};

// Smart list definitions with empty state messages
const SMART_LISTS = {
    all: { 
        label: 'All Tasks', 
        icon: 'inbox', 
        filter: () => true,
        emptyTitle: 'No tasks yet',
        emptyMessage: 'Add your first task to get started!'
    },
    today: {
        label: 'Due Today', 
        icon: 'calendar', 
        filter: (task) => isToday(task.dueDate),
        emptyTitle: 'Nothing due today',
        emptyMessage: 'Enjoy your free time! 🎉'
    },
    overdue: {
        label: 'Overdue', 
        icon: 'alert-circle', 
        filter: (task) => isOverdue(task.dueDate),
        emptyTitle: 'All caught up!',
        emptyMessage: 'No overdue tasks. Great job! ✨'
    },
    week: {
        label: 'This Week', 
        icon: 'calendar-days', 
        filter: (task) => isThisWeek(task.dueDate),
        emptyTitle: 'Week looks clear',
        emptyMessage: 'No tasks due this week'
    },
    highPriority: {
        label: 'High Priority', 
        icon: 'alert-triangle', 
        filter: (task) => task.priority === 'high',
        emptyTitle: 'No urgent tasks',
        emptyMessage: 'Nothing marked high priority right now'
    }
};

// Enhanced date/time parser
function parseNaturalDateTime(input) {
    if (!input) return null;
    
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const lower = input.toLowerCase().trim();
    
    // Extract time if present (e.g., "tomorrow at 3pm", "monday 14:30")
    let time = null;
    const timePatterns = [
        /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
        /(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/
    ];
    
    let dateStr = lower;
    for (const pattern of timePatterns) {
        const match = lower.match(pattern);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10) || 0;
            const meridiem = match[3];
            
            if (meridiem) {
                if (meridiem.toLowerCase() === 'pm' && hours !== 12) hours += 12;
                if (meridiem.toLowerCase() === 'am' && hours === 12) hours = 0;
            }
            
            time = { hours, minutes };
            dateStr = lower.replace(pattern, '').replace(/\s+at\s*$/, '').trim();
            break;
        }
    }
    
    let resultDate = null;
    
    // Relative dates
    if (dateStr === 'today' || dateStr === '') {
        resultDate = new Date(today);
    } else if (dateStr === 'tomorrow' || dateStr === 'tmr' || dateStr === 'tom') {
        resultDate = new Date(today);
        resultDate.setDate(resultDate.getDate() + 1);
    } else if (dateStr === 'yesterday') {
        resultDate = new Date(today);
        resultDate.setDate(resultDate.getDate() - 1);
    } else if (dateStr === 'next week') {
        resultDate = new Date(today);
        resultDate.setDate(resultDate.getDate() + 7);
    } else {
        // In X days
        const inDaysMatch = dateStr.match(/^in (\d+) days?$/);
        if (inDaysMatch) {
            resultDate = new Date(today);
            resultDate.setDate(resultDate.getDate() + parseInt(inDaysMatch[1], 10));
        }
        
        // Day names
        if (!resultDate) {
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayIndex = days.findIndex(d => dateStr.startsWith(d) || dateStr === d.slice(0, 3));
            if (dayIndex !== -1) {
                resultDate = new Date(today);
                const currentDay = resultDate.getDay();
                let daysToAdd = dayIndex - currentDay;
                if (daysToAdd <= 0) daysToAdd += 7;
                if (dateStr.includes('next')) daysToAdd += 7;
                resultDate.setDate(resultDate.getDate() + daysToAdd);
            }
        }
        
        // Try parsing as date
        if (!resultDate) {
            const parsed = new Date(input);
            if (!isNaN(parsed.getTime())) {
                resultDate = parsed;
            }
        }
        
        // MM/DD or MM-DD format
        if (!resultDate) {
            const shortDateMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
            if (shortDateMatch) {
                resultDate = new Date(today.getFullYear(), parseInt(shortDateMatch[1], 10) - 1, parseInt(shortDateMatch[2], 10));
                if (resultDate < today) resultDate.setFullYear(resultDate.getFullYear() + 1);
            }
        }
    }
    
    if (!resultDate) return null;
    
    // Apply time if found
    if (time) {
        resultDate.setHours(time.hours, time.minutes, 0, 0);
    } else {
        resultDate.setHours(0, 0, 0, 0);
    }
    
    return resultDate;
}

// Legacy alias
function parseNaturalDate(input) {
    return parseNaturalDateTime(input);
}

function isToday(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    return date.toDateString() === today.toDateString();
}

function isOverdue(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    // For dates with no time, compare at end of day
    if (date.getHours() === 0 && date.getMinutes() === 0) {
        date.setHours(23, 59, 59, 999);
    }
    return date < now && !isToday(dateStr);
}

function isThisWeek(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);
    today.setHours(0, 0, 0, 0);
    return date >= today && date <= endOfWeek;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);

    // Validate date is valid
    if (isNaN(date.getTime())) return '';

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
    const timeStr = hasTime ? ` ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
    
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(0, 0, 0, 0);
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);
    
    if (dateOnly.getTime() === todayStart.getTime()) return 'Today' + timeStr;
    if (dateOnly.getTime() === tomorrowStart.getTime()) return 'Tomorrow' + timeStr;
    
    const diff = Math.floor((dateOnly - todayStart) / (1000 * 60 * 60 * 24));
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff < 7) {
        return date.toLocaleDateString('en-US', { weekday: 'short' }) + timeStr;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + timeStr;
}

function getNextRecurrence(dateStr, recurrence, endDateStr = null) {
    if (!dateStr || !recurrence) return null;

    // Parse the original due date
    const originalDate = new Date(dateStr);

    // Safety check
    if (isNaN(originalDate.getTime())) return null;

    // Use today at midnight as the base if the task is overdue
    // This prevents creating recurring tasks in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create a copy of the original date for comparison (at midnight for accurate date comparison)
    const originalDateMidnight = new Date(originalDate);
    originalDateMidnight.setHours(0, 0, 0, 0);

    // Preserve the original time for recurring tasks
    const hadTime = originalDate.getHours() !== 0 || originalDate.getMinutes() !== 0;
    const originalHours = originalDate.getHours();
    const originalMinutes = originalDate.getMinutes();

    // Start from the later of today or the original due date
    let baseDate;
    if (originalDateMidnight < today) {
        // Task is overdue - start from today but preserve original time
        baseDate = new Date(today);
        if (hadTime) {
            baseDate.setHours(originalHours, originalMinutes, 0, 0);
        }
    } else {
        // Task is today or in the future - use original date
        baseDate = new Date(originalDate);
    }

    switch (recurrence) {
        case 'daily': baseDate.setDate(baseDate.getDate() + 1); break;
        case 'weekly': baseDate.setDate(baseDate.getDate() + 7); break;
        default: return null;
    }

    // Check if next occurrence is past the end date
    if (endDateStr) {
        const endDate = new Date(endDateStr);
        endDate.setHours(23, 59, 59, 999); // End of day
        if (baseDate > endDate) {
            return null; // Recurrence has ended
        }
    }

    return baseDate.toISOString();
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function extractTags(text) {
    // Support Unicode letters and numbers in tags
    const tagRegex = /#[\p{L}\p{N}_-]+/gu;
    return (text.match(tagRegex) || []).map(t => t.toLowerCase());
}

// Escape HTML entities to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Safely render task text with highlights and tags (returns safe HTML)
function renderTaskTextSafe(text, tags, searchQuery) {
    // First escape the text to prevent XSS
    let safeText = escapeHtml(text);

    // Apply search highlighting (using escaped text)
    if (searchQuery) {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapeHtml(escaped)})`, 'gi');
        safeText = safeText.replace(regex, '<mark class="todo-search-highlight">$1</mark>');
    }

    // Apply tag highlighting (tags are already escaped since we escaped the whole text)
    (tags || []).forEach(tag => {
        const escapedTag = escapeHtml(tag);
        const tagRegex = new RegExp(escapedTag.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&'), 'g');
        safeText = safeText.replace(tagRegex, `<span class="todo-inline-tag">${escapedTag}</span>`);
    });

    return safeText;
}

// Format date as YYYY-MM-DD for Full Calendar
function formatDateForCalendar(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Format time as HH:mm for Full Calendar
function formatTimeForCalendar(hours, minutes) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

class TodoChecklistView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.data = {
            lists: {
                'default': { name: 'My Tasks', color: null, todos: [], archived: [] }
            },
            currentList: 'default',
            settings: { ...DEFAULT_SETTINGS }
        };
        this.currentSmartList = null;
        this.searchQuery = '';
        this.filterTag = null;
        this.expandedTasks = new Set();
        this.draggedId = null;
        
        // Keyboard navigation state
        this.selectedTaskIndex = -1;
        this.selectedTaskId = null;  // Track by ID for stable selection across re-renders
        this.isKeyboardNavActive = false;

        // Undo stack
        this.undoStack = [];
        this.maxUndoSize = CONFIG.MAX_UNDO_STACK_SIZE;

        // Loading state
        this.isLoading = false;

        // Dirty flag for save tracking
        this._dirty = false;

        // Tags cache for performance
        this._tagsCache = null;
    }

    getViewType() { return VIEW_TYPE_TODO; }
    getDisplayText() { return 'Todo Checklist'; }
    getIcon() { return 'check-square'; }

    // Check if running on mobile platform
    get isMobile() {
        return Platform.isMobile || Platform.isMobileApp;
    }

    // Check if device supports touch (for drag/drop handling)
    get isTouchDevice() {
        return this.isMobile || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    }

    async onOpen() {
        // Re-initialize state that may have been cleared in onClose
        if (!this.expandedTasks) this.expandedTasks = new Set();
        if (!this.undoStack) this.undoStack = [];

        await this.loadData();
        this.render();
        this.registerKeyboardHandlers();
        this.registerEventDelegation();
        this.startNotificationChecker();
    }

    async onClose() {
        // Clean up keyboard event listener
        if (this.boundKeydownHandler) {
            this.containerEl.removeEventListener('keydown', this.boundKeydownHandler);
            this.boundKeydownHandler = null;
        }
        // Clean up delegated click handler
        if (this.boundClickHandler) {
            this.containerEl.removeEventListener('click', this.boundClickHandler);
            this.boundClickHandler = null;
        }
        // Clean up delegated change handler
        if (this.boundChangeHandler) {
            this.containerEl.removeEventListener('change', this.boundChangeHandler);
            this.boundChangeHandler = null;
        }
        // Clean up delegated input handler
        if (this.boundInputHandler) {
            this.containerEl.removeEventListener('input', this.boundInputHandler);
            this.boundInputHandler = null;
        }
        // Clean up delegated keydown handler
        if (this.boundKeydownDelegatedHandler) {
            this.containerEl.removeEventListener('keydown', this.boundKeydownDelegatedHandler);
            this.boundKeydownDelegatedHandler = null;
        }
        // Clean up save timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        // Clean up key combo timeout
        if (this.keyComboTimeout) {
            clearTimeout(this.keyComboTimeout);
            this.keyComboTimeout = null;
        }
        // Clean up search timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
        // Clean up archiving state
        if (this._archivingIds) {
            this._archivingIds.clear();
            this._archivingIds = null;
        }
        // Clean up tags cache
        this._tagsCache = null;
        // Clean up expanded tasks set
        if (this.expandedTasks) {
            this.expandedTasks.clear();
            this.expandedTasks = null;
        }
        // Clear undo stack to free memory
        this.undoStack = [];
        // Use immediate save on close to ensure data is persisted
        await this.saveDataImmediate();
        if (this.notificationInterval) {
            clearInterval(this.notificationInterval);
            this.notificationInterval = null;
        }
    }

    registerKeyboardHandlers() {
        // Store handler reference for cleanup
        this.boundKeydownHandler = (e) => this.handleKeyDown(e);
        this.containerEl.addEventListener('keydown', this.boundKeydownHandler);
        this.containerEl.setAttribute('tabindex', '0');
    }

    // Event delegation - single handlers for all interactive elements
    registerEventDelegation() {
        // Delegated click handler
        this.boundClickHandler = (e) => this.handleDelegatedClick(e);
        this.containerEl.addEventListener('click', this.boundClickHandler);

        // Delegated change handler (for checkboxes)
        this.boundChangeHandler = (e) => this.handleDelegatedChange(e);
        this.containerEl.addEventListener('change', this.boundChangeHandler);

        // Delegated input handler (for search debouncing)
        this.boundInputHandler = (e) => this.handleDelegatedInput(e);
        this.containerEl.addEventListener('input', this.boundInputHandler);

        // Delegated keydown handler (for subtask input Enter key)
        this.boundKeydownDelegatedHandler = (e) => this.handleDelegatedKeydown(e);
        this.containerEl.addEventListener('keydown', this.boundKeydownDelegatedHandler);
    }

    handleDelegatedKeydown(e) {
        // Handle Enter key on subtask input
        if (e.target.classList.contains('todo-subtask-input') && e.key === 'Enter') {
            const parentTaskId = e.target.dataset.parentTaskId;
            const value = e.target.value.trim();
            if (parentTaskId && value) {
                this.addSubtask(parentTaskId, value);
                e.target.value = '';
            }
            e.stopPropagation();
        }

        // Handle search input keydown
        if (e.target.classList.contains('todo-search-input')) {
            if (e.key === 'Enter') {
                if (this.searchTimeout) clearTimeout(this.searchTimeout);
                this.searchQuery = e.target.value;
                this.renderContent();
                e.stopPropagation();
            }
            if (e.key === 'Escape') {
                e.target.blur();
                e.stopPropagation();
            }
        }

        // Handle main task input keydown
        if (e.target.classList.contains('todo-input')) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = e.target.value.trim();
                if (!text) return;

                if (e.ctrlKey || e.metaKey) {
                    // Quick add with Ctrl+Enter
                    this.quickAddTodo(text);
                    e.target.value = '';
                } else {
                    // Show detailed modal with Enter
                    this.showAddTaskModal(text);
                    e.target.value = '';
                }
                e.stopPropagation();
            }
            if (e.key === 'Escape') {
                e.target.blur();
                e.stopPropagation();
            }
        }
    }

    handleDelegatedClick(e) {
        // Find the closest element with a data-action attribute
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        const taskId = actionEl.dataset.taskId;
        const listId = actionEl.dataset.listId;
        const parentId = actionEl.dataset.parentId;
        const tag = actionEl.dataset.tag;
        const smartList = actionEl.dataset.smartList;
        const sortValue = actionEl.dataset.sortValue;

        e.stopPropagation();

        switch (action) {
            // Task actions
            case 'edit':
                this.editTodo(this.getTaskById(taskId));
                break;
            case 'priority':
                this.cyclePriority(this.getTaskById(taskId));
                break;
            case 'link':
                this.quickLinkNote(this.getTaskById(taskId));
                break;
            case 'move':
                this.showMoveTaskModal(this.getTaskById(taskId));
                break;
            case 'delete':
                this.deleteTodoWithConfirm(taskId);
                break;
            case 'delete-subtask':
                this.deleteSubtask(parentId, taskId);
                break;
            case 'delete-archived':
                this.deleteArchived(taskId);
                break;
            case 'expand':
                if (this.expandedTasks.has(taskId)) {
                    this.expandedTasks.delete(taskId);
                } else {
                    this.expandedTasks.add(taskId);
                }
                this.render();
                break;
            case 'open-linked-note':
                this.openLinkedNote(actionEl.dataset.notePath);
                break;

            // Sidebar actions
            case 'select-smart-list':
                this.currentSmartList = this.currentSmartList === smartList ? null : smartList;
                this.selectedTaskIndex = -1;
                this.selectedTaskId = null;
                this.render();
                break;
            case 'select-list':
                this.currentSmartList = null;
                this.data.currentList = listId;
                this.selectedTaskIndex = -1;
                this.selectedTaskId = null;
                this.saveData();
                this.render();
                break;
            case 'select-tag':
                this.filterTag = this.filterTag === tag ? null : tag;
                this.selectedTaskIndex = -1;
                this.selectedTaskId = null;
                this.render();
                break;
            case 'add-list':
                this.createNewList();
                break;
            case 'open-settings':
                this.openSettingsModal();
                break;
            case 'undo':
                this.undo();
                break;

            // Header actions
            case 'clear-search':
                this.searchQuery = '';
                this.render();
                break;
            case 'set-sort':
                this.data.settings.sortBy = sortValue;
                this.saveData();
                this.render();
                break;
            case 'clear-filter-tag':
                this.filterTag = null;
                this.render();
                break;
            case 'clear-filter-search':
                this.searchQuery = '';
                this.render();
                break;

            // Input section
            case 'add-task':
                const input = this.containerEl.querySelector('.todo-input');
                if (input && input.value.trim()) {
                    this.showAddTaskModal(input.value.trim());
                    input.value = '';
                }
                break;

            // Archived section
            case 'toggle-archived':
                this.data.settings.showArchived = !this.data.settings.showArchived;
                this.saveData();
                this.render();
                break;
            case 'clear-archived':
                this.clearArchivedWithConfirm();
                break;
        }
    }

    handleDelegatedChange(e) {
        const checkbox = e.target.closest('.todo-checkbox');
        if (!checkbox) return;

        const item = checkbox.closest('.todo-item');
        if (!item) return;

        const taskId = item.dataset.id;
        const isSubtask = item.classList.contains('subtask');
        const isArchived = item.classList.contains('archived');
        const parentId = item.dataset.parentId;

        if (isSubtask && parentId) {
            this.toggleSubtask(parentId, taskId);
        } else if (isArchived) {
            this.unarchiveTodo(taskId);
        } else {
            this.archiveTodo(taskId);
        }
    }

    handleDelegatedInput(e) {
        // Handle search input with debouncing
        if (e.target.classList.contains('todo-search-input')) {
            const value = e.target.value;
            const cursorPos = e.target.selectionStart;

            if (this.searchTimeout) clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.searchQuery = value;
                this.selectedTaskIndex = -1;
                this.selectedTaskId = null;
                this.renderContent();
                const searchInput = this.containerEl.querySelector('.todo-search-input');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.setSelectionRange(cursorPos, cursorPos);
                }
            }, 150);
        }

        // Handle sidebar filter
        if (e.target.classList.contains('todo-sidebar-search-input')) {
            const value = e.target.value.toLowerCase();
            const sidebar = this.containerEl.querySelector('.todo-sidebar');
            if (sidebar) {
                sidebar.querySelectorAll('.todo-sidebar-item[data-filterable]').forEach(item => {
                    const text = item.textContent.toLowerCase();
                    item.style.display = text.includes(value) ? '' : 'none';
                });
            }
        }
    }

    // Helper to get task by ID from any list
    getTaskById(taskId) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const task = list.todos.find(t => t.id === taskId);
            if (task) return task;
            const archivedTask = list.archived.find(t => t.id === taskId);
            if (archivedTask) return archivedTask;
        }
        return null;
    }

    handleKeyDown(e) {
        // Skip keyboard shortcuts on mobile devices (virtual keyboard interference)
        if (this.isMobile) {
            return;
        }

        // Ignore if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            // Allow Escape to exit input
            if (e.key === 'Escape') {
                e.target.blur();
                if (this.data.settings.enableKeyboardNavigation) {
                    this.isKeyboardNavActive = true;
                    this.updateSelectedTaskVisual();
                }
            }
            return;
        }

        // Always allow Ctrl+Z for undo, even if keyboard navigation is disabled
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }

        // Skip other keyboard shortcuts if navigation is disabled
        if (!this.data.settings.enableKeyboardNavigation) {
            return;
        }

        const todos = this.getFilteredTodos();

        switch (e.key) {
            case 'j':
            case 'ArrowDown':
                e.preventDefault();
                this.isKeyboardNavActive = true;
                this.selectedTaskIndex = Math.min(this.selectedTaskIndex + 1, todos.length - 1);
                this.selectedTaskId = todos[this.selectedTaskIndex]?.id || null;
                this.updateSelectedTaskVisual();
                this.scrollSelectedIntoView();
                break;

            case 'k':
            case 'ArrowUp':
                e.preventDefault();
                this.isKeyboardNavActive = true;
                this.selectedTaskIndex = Math.max(this.selectedTaskIndex - 1, 0);
                this.selectedTaskId = todos[this.selectedTaskIndex]?.id || null;
                this.updateSelectedTaskVisual();
                this.scrollSelectedIntoView();
                break;
                
            case 'x':
            case ' ':
                e.preventDefault();
                if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < todos.length) {
                    this.archiveTodo(todos[this.selectedTaskIndex].id);
                }
                break;
                
            case 'e':
            case 'Enter':
                e.preventDefault();
                if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < todos.length) {
                    this.editTodo(todos[this.selectedTaskIndex]);
                }
                break;
                
            case 'd':
            case 'Delete':
                e.preventDefault();
                if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < todos.length) {
                    this.deleteTodoWithConfirm(todos[this.selectedTaskIndex].id);
                }
                break;
                
            case 'm':
                e.preventDefault();
                if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < todos.length) {
                    this.showMoveTaskModal(todos[this.selectedTaskIndex]);
                }
                break;
                
            case 'p':
                e.preventDefault();
                if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < todos.length) {
                    this.cyclePriority(todos[this.selectedTaskIndex]);
                }
                break;
                
            case 'n':
                e.preventDefault();
                const input = this.containerEl.querySelector('.todo-input');
                if (input) input.focus();
                break;
                
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.undo();
                }
                break;
                
            case '/':
                e.preventDefault();
                const searchInput = this.containerEl.querySelector('.todo-search-input');
                if (searchInput) searchInput.focus();
                break;
                
            case 'Escape':
                this.isKeyboardNavActive = false;
                this.selectedTaskIndex = -1;
                this.selectedTaskId = null;
                this.updateSelectedTaskVisual();
                break;
                
            case 'g':
                // gg to go to top
                if (this.lastKey === 'g') {
                    e.preventDefault();
                    this.selectedTaskIndex = 0;
                    this.selectedTaskId = todos[0]?.id || null;
                    this.isKeyboardNavActive = true;
                    this.updateSelectedTaskVisual();
                    this.scrollSelectedIntoView();
                }
                break;

            case 'G':
                // G to go to bottom
                e.preventDefault();
                this.selectedTaskIndex = todos.length - 1;
                this.selectedTaskId = todos[this.selectedTaskIndex]?.id || null;
                this.isKeyboardNavActive = true;
                this.updateSelectedTaskVisual();
                this.scrollSelectedIntoView();
                break;
        }
        
        this.lastKey = e.key;
        // Clear any existing timeout before setting a new one
        if (this.keyComboTimeout) clearTimeout(this.keyComboTimeout);
        this.keyComboTimeout = setTimeout(() => this.lastKey = null, CONFIG.KEY_COMBO_TIMEOUT_MS);
    }

    updateSelectedTaskVisual() {
        // Remove previous selection
        this.containerEl.querySelectorAll('.todo-item.keyboard-selected').forEach(el => {
            el.classList.remove('keyboard-selected');
        });
        
        if (!this.isKeyboardNavActive || this.selectedTaskIndex < 0) return;
        
        const items = this.containerEl.querySelectorAll('.todo-section > .todo-list > .todo-item');
        if (items[this.selectedTaskIndex]) {
            items[this.selectedTaskIndex].classList.add('keyboard-selected');
        }
    }

    scrollSelectedIntoView() {
        const items = this.containerEl.querySelectorAll('.todo-section > .todo-list > .todo-item');
        if (items[this.selectedTaskIndex]) {
            items[this.selectedTaskIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Deep clone a task to prevent shared references in undo stack
    cloneTask(task) {
        if (!task) return null;
        // Use JSON for true deep clone - handles all nested objects/arrays
        return JSON.parse(JSON.stringify(task));
    }

    // Undo functionality
    pushUndo(action, data) {
        // Deep clone task data to prevent mutations from affecting undo state
        const clonedData = { ...data };
        if (clonedData.task) {
            clonedData.task = this.cloneTask(clonedData.task);
        }
        this.undoStack.push({ action, data: clonedData, timestamp: Date.now() });
        if (this.undoStack.length > this.maxUndoSize) {
            this.undoStack.shift();
        }
    }

    async undo() {
        // Block undo during archive animation to prevent race conditions
        if (this._archivingIds?.size > 0) {
            new Notice('Please wait for animation to complete');
            return;
        }

        if (this.undoStack.length === 0) {
            new Notice('Nothing to undo');
            return;
        }

        const lastAction = this.undoStack.pop();
        
        switch (lastAction.action) {
            case 'delete':
                // Restore deleted task
                const task = lastAction.data.task;
                const listId = lastAction.data.listId;
                if (this.data.lists[listId]) {
                    this.data.lists[listId].todos.unshift(task);

                    // Recreate calendar file if task has due date
                    if (this.data.settings.fullCalendarSync && task.dueDate) {
                        await this.syncTaskToCalendar(task);
                    }

                    await this.saveData();
                    this.render();
                    new Notice('Task restored');
                }
                break;
                
            case 'complete':
                // Un-complete task
                const completedTask = lastAction.data.task;
                const completedListId = lastAction.data.listId;
                if (this.data.lists[completedListId]) {
                    const archiveIndex = this.data.lists[completedListId].archived.findIndex(t => t.id === completedTask.id);
                    if (archiveIndex !== -1) {
                        const [restored] = this.data.lists[completedListId].archived.splice(archiveIndex, 1);
                        delete restored.completedAt;
                        this.data.lists[completedListId].todos.unshift(restored);

                        // Update calendar to mark as not completed
                        if (this.data.settings.fullCalendarSync && restored.calendarEventPath) {
                            this.updateCalendarEventCompletion(restored, false);
                        }

                        await this.saveData();
                        this.render();
                        new Notice('Task uncompleted');
                    }
                }
                break;
                
            case 'move':
                // Move back to original list
                const movedTask = lastAction.data.task;
                const fromList = lastAction.data.fromList;
                const toList = lastAction.data.toList;
                const toIndex = this.data.lists[toList]?.todos.findIndex(t => t.id === movedTask.id);
                if (toIndex !== -1 && this.data.lists[fromList]) {
                    const [task] = this.data.lists[toList].todos.splice(toIndex, 1);
                    this.data.lists[fromList].todos.unshift(task);
                    await this.saveData();
                    this.render();
                    new Notice('Move undone');
                }
                break;

            case 'delete-archived':
                // Restore deleted archived task
                const archivedTask = lastAction.data.task;
                const archivedListId = lastAction.data.listId;
                if (this.data.lists[archivedListId]) {
                    this.data.lists[archivedListId].archived.unshift(archivedTask);

                    // Recreate calendar file if task has due date (and mark as completed)
                    if (this.data.settings.fullCalendarSync && archivedTask.dueDate) {
                        await this.syncTaskToCalendar(archivedTask);
                        if (archivedTask.calendarEventPath) {
                            this.updateCalendarEventCompletion(archivedTask, true);
                        }
                    }

                    await this.saveData();
                    this.render();
                    new Notice('Completed task restored');
                }
                break;

            case 'clear-archived-batch':
                // Restore all cleared archived tasks
                const clearedTasks = lastAction.data.tasks; // Array of { task, listId }
                let restoredCount = 0;
                for (const { task: clearedTask, listId: clearedListId } of clearedTasks) {
                    if (this.data.lists[clearedListId]) {
                        this.data.lists[clearedListId].archived.push(clearedTask);
                        restoredCount++;
                    }
                }
                if (restoredCount > 0) {
                    await this.saveData();
                    this.render();
                    new Notice(`Restored ${restoredCount} completed task${restoredCount !== 1 ? 's' : ''}`);
                }
                break;

            case 'edit':
                // Restore task to previous state
                const editedTask = lastAction.data.task;
                const editListId = lastAction.data.listId;
                if (this.data.lists[editListId]) {
                    const editIndex = this.data.lists[editListId].todos.findIndex(t => t.id === editedTask.id);
                    if (editIndex !== -1) {
                        // Restore the old version
                        this.data.lists[editListId].todos[editIndex] = editedTask;

                        // Sync calendar if needed
                        if (this.data.settings.fullCalendarSync) {
                            if (editedTask.dueDate) {
                                await this.syncTaskToCalendar(editedTask);
                            } else if (editedTask.calendarEventPath) {
                                await this.removeTaskFromCalendar(editedTask);
                            }
                        }

                        await this.saveData();
                        this.render();
                        new Notice('Edit undone');
                    }
                }
                break;

            case 'add':
                // Remove the added task
                const addedTask = lastAction.data.task;
                const addListId = lastAction.data.listId;
                if (this.data.lists[addListId]) {
                    const addIndex = this.data.lists[addListId].todos.findIndex(t => t.id === addedTask.id);
                    if (addIndex !== -1) {
                        const [removedTask] = this.data.lists[addListId].todos.splice(addIndex, 1);

                        // Remove calendar file if it was created
                        if (removedTask.calendarEventPath) {
                            await this.removeTaskFromCalendar(removedTask);
                        }

                        await this.saveData();
                        this.render();
                        new Notice('Task creation undone');
                    }
                }
                break;
        }
    }

    startNotificationChecker() {
        // Clear existing interval if any (defensive)
        if (this.notificationInterval) clearInterval(this.notificationInterval);
        this.notificationInterval = setInterval(() => {
            if (this.data.settings.notifications) {
                this.checkDueTasks();
            }
        }, CONFIG.NOTIFICATION_CHECK_INTERVAL_MS);
    }

    checkDueTasks() {
        const now = new Date();
        let needsSave = false;

        for (const listId in this.data.lists) {
            this.data.lists[listId].todos.forEach(task => {
                if (task.dueDate && !task.notified) {
                    const dueDate = new Date(task.dueDate);
                    // Notify for tasks due today at 9am
                    if (isToday(task.dueDate) && now.getHours() >= 9 && now.getHours() < 10) {
                        new Notice(`Task due today: ${task.text}`, 5000);
                        task.notified = true;
                        needsSave = true;
                    }
                    // Notify 15 min before for tasks with specific times
                    if (dueDate.getHours() !== 0 || dueDate.getMinutes() !== 0) {
                        const timeDiff = dueDate - now;
                        if (timeDiff > 0 && timeDiff <= 15 * 60 * 1000 && !task.notified15) {
                            new Notice(`Task in 15 minutes: ${task.text}`, 5000);
                            task.notified15 = true;
                            needsSave = true;
                        }
                    }
                }
            });
        }

        // Batch save at the end instead of multiple saves
        if (needsSave) {
            this.saveData();
        }
    }

    // Validate and sanitize a task object
    validateTask(task) {
        if (!task || typeof task !== 'object') return null;

        // Must have text or we can't display it
        if (!task.text || typeof task.text !== 'string') return null;

        return {
            id: (typeof task.id === 'string' && task.id) ? task.id : generateId(),
            text: String(task.text).slice(0, CONFIG.MAX_TASK_TEXT_LENGTH),
            priority: ['high', 'medium', 'low', 'none'].includes(task.priority) ? task.priority : 'none',
            dueDate: task.dueDate || null,
            startTime: task.startTime || null,
            endTime: task.endTime || null,
            allDay: task.allDay !== false,
            recurrence: ['daily', 'weekly'].includes(task.recurrence) ? task.recurrence : null,
            recurrenceEndDate: task.recurrenceEndDate || null,
            tags: Array.isArray(task.tags) ? task.tags.filter(t => typeof t === 'string') : extractTags(task.text || ''),
            subtasks: Array.isArray(task.subtasks) ? task.subtasks.filter(s => s && typeof s.text === 'string').map(s => ({
                id: s.id || generateId(),
                text: String(s.text).slice(0, CONFIG.MAX_SUBTASK_TEXT_LENGTH),
                completed: Boolean(s.completed),
                createdAt: s.createdAt || Date.now()
            })) : [],
            notes: typeof task.notes === 'string' ? task.notes.slice(0, CONFIG.MAX_TASK_NOTES_LENGTH) : '',
            linkedNote: typeof task.linkedNote === 'string' ? task.linkedNote : null,
            calendarEventPath: typeof task.calendarEventPath === 'string' ? task.calendarEventPath : null,
            createdAt: task.createdAt || Date.now(),
            completedAt: task.completedAt || undefined,
            notified: Boolean(task.notified),
            notified15: Boolean(task.notified15)
        };
    }

    // Validate a list object
    validateList(list, listId) {
        if (!list || typeof list !== 'object') {
            return { name: listId || 'Untitled', color: null, todos: [], archived: [] };
        }

        const validatedTodos = Array.isArray(list.todos)
            ? list.todos.map(t => this.validateTask(t)).filter(Boolean)
            : [];

        const validatedArchived = Array.isArray(list.archived)
            ? list.archived.map(t => this.validateTask(t)).filter(Boolean)
            : [];

        return {
            name: typeof list.name === 'string' ? list.name.slice(0, CONFIG.MAX_LIST_NAME_LENGTH) : (listId || 'Untitled'),
            color: typeof list.color === 'string' ? list.color : null,
            todos: validatedTodos,
            archived: validatedArchived
        };
    }

    async loadData() {
        try {
            const saved = await this.plugin.loadData();
            if (saved && typeof saved === 'object') {
                // Validate settings against defaults
                const savedSettings = (saved.settings && typeof saved.settings === 'object') ? saved.settings : {};
                const settings = {};
                for (const key in DEFAULT_SETTINGS) {
                    const defaultVal = DEFAULT_SETTINGS[key];
                    const savedVal = savedSettings[key];
                    if (key === 'sortBy') {
                        // Special validation for sortBy enum
                        settings[key] = ['manual', 'priority', 'dueDate', 'created'].includes(savedVal) ? savedVal : defaultVal;
                    } else if (typeof defaultVal === 'boolean') {
                        settings[key] = typeof savedVal === 'boolean' ? savedVal : defaultVal;
                    } else if (typeof defaultVal === 'string') {
                        settings[key] = typeof savedVal === 'string' ? savedVal : defaultVal;
                    } else {
                        settings[key] = savedVal !== undefined ? savedVal : defaultVal;
                    }
                }

                // Validate lists
                let lists = {};
                if (saved.lists && typeof saved.lists === 'object') {
                    for (const listId in saved.lists) {
                        lists[listId] = this.validateList(saved.lists[listId], listId);
                    }
                }

                // Ensure at least one list exists
                if (Object.keys(lists).length === 0) {
                    lists['default'] = { name: 'My Tasks', todos: [], archived: [] };
                }

                // Validate currentList reference
                let currentList = saved.currentList;
                if (typeof currentList !== 'string' || !lists[currentList]) {
                    currentList = Object.keys(lists)[0];
                }

                this.data = {
                    lists,
                    currentList,
                    settings
                };
            }
        } catch (e) {
            console.error('Failed to load todo data:', e);
            new Notice('Failed to load todo data. Starting with empty list.');
            // Reset to defaults on error
            this.data = {
                lists: { 'default': { name: 'My Tasks', color: null, todos: [], archived: [] } },
                currentList: 'default',
                settings: { ...DEFAULT_SETTINGS }
            };
        }
    }

    // Debounced save to prevent rapid-fire writes
    saveData() {
        this._dirty = true;
        this._tagsCache = null; // Invalidate tags cache on data change
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            if (this._dirty) {
                this._dirty = false;
                await this.plugin.saveData(this.data);
            }
        }, CONFIG.DEBOUNCE_SAVE_MS);
    }

    // Immediate save for critical operations (e.g., before closing)
    async saveDataImmediate() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        // Always save on immediate to ensure data is persisted (e.g., on close)
        this._dirty = false;
        await this.plugin.saveData(this.data);
    }

    getCurrentList() {
        return this.data.lists[this.data.currentList] || this.data.lists['default'];
    }

    getListIdForTask(taskId) {
        for (const listId in this.data.lists) {
            if (this.data.lists[listId].todos.find(t => t.id === taskId)) {
                return listId;
            }
            if (this.data.lists[listId].archived.find(t => t.id === taskId)) {
                return listId;
            }
        }
        return null;
    }

    getAllTags() {
        // Return cached tags if available
        if (this._tagsCache) return this._tagsCache;

        const tags = new Set();
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            [...list.todos, ...list.archived].forEach(task => {
                (task.tags || []).forEach(tag => tags.add(tag));
            });
        }
        this._tagsCache = Array.from(tags).sort();
        return this._tagsCache;
    }

    getFilteredTodos() {
        let todos = [];

        if (this.currentSmartList) {
            // Validate smart list exists
            const smartList = SMART_LISTS[this.currentSmartList];
            if (!smartList || typeof smartList.filter !== 'function') {
                console.warn('Invalid smart list:', this.currentSmartList);
                this.currentSmartList = null;
                return this.getFilteredTodos();
            }
            for (const listId in this.data.lists) {
                todos = todos.concat(
                    this.data.lists[listId].todos.filter(smartList.filter)
                );
            }
        } else {
            todos = [...this.getCurrentList().todos];
        }
        
        if (this.filterTag) {
            todos = todos.filter(t => (t.tags || []).includes(this.filterTag));
        }
        
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            todos = todos.filter(t => 
                t.text.toLowerCase().includes(query) ||
                (t.notes || '').toLowerCase().includes(query) ||
                (t.tags || []).some(tag => tag.includes(query))
            );
        }
        
        return this.sortTodos(todos);
    }

    getFilteredArchived() {
        let archived = [];
        
        if (this.currentSmartList) {
            for (const listId in this.data.lists) {
                archived = archived.concat(this.data.lists[listId].archived);
            }
        } else {
            archived = [...this.getCurrentList().archived];
        }
        
        if (this.filterTag) {
            archived = archived.filter(t => (t.tags || []).includes(this.filterTag));
        }
        
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            archived = archived.filter(t =>
                t.text.toLowerCase().includes(query) ||
                (t.notes || '').toLowerCase().includes(query) ||
                (t.tags || []).some(tag => tag.toLowerCase().includes(query))
            );
        }

        return archived;
    }

    sortTodos(todos) {
        const sortBy = this.data.settings.sortBy;
        // Create a copy to avoid mutating the original array
        const sortedTodos = [...todos];
        switch (sortBy) {
            case 'priority':
                return sortedTodos.sort((a, b) =>
                    PRIORITIES[a.priority || 'none'].sort - PRIORITIES[b.priority || 'none'].sort
                );
            case 'dueDate':
                return sortedTodos.sort((a, b) => {
                    if (!a.dueDate && !b.dueDate) return 0;
                    if (!a.dueDate) return 1;
                    if (!b.dueDate) return -1;
                    return new Date(a.dueDate) - new Date(b.dueDate);
                });
            case 'created':
                return sortedTodos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            default:
                return sortedTodos;
        }
    }

    setLoading(loading) {
        this.isLoading = loading;
        const loader = this.containerEl.querySelector('.todo-loading-overlay');
        if (loading) {
            if (!loader) {
                const overlay = document.createElement('div');
                overlay.className = 'todo-loading-overlay';
                overlay.innerHTML = '<div class="todo-loading-spinner"></div>';
                this.containerEl.querySelector('.todo-main-content')?.appendChild(overlay);
            }
        } else {
            loader?.remove();
        }
    }

    render() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('todo-checklist-container');

        // Toggle animations class based on setting
        if (this.data.settings.enableAnimations) {
            container.removeClass('no-animations');
        } else {
            container.addClass('no-animations');
        }

        // Reset keyboard nav state if setting is disabled
        if (!this.data.settings.enableKeyboardNavigation && this.isKeyboardNavActive) {
            this.isKeyboardNavActive = false;
            this.selectedTaskIndex = -1;
            this.selectedTaskId = null;
        }

        this.renderSidebar(container);
        const mainContent = container.createDiv({ cls: 'todo-main-content' });

        this.renderHeader(mainContent);
        this.renderKeyboardHint(mainContent);
        this.renderActiveFilters(mainContent);
        this.renderInputSection(mainContent);
        this.renderTodosList(mainContent);
        this.renderArchivedSection(mainContent);

        // Restore keyboard selection by ID for stability across re-renders
        this.restoreSelectionById();
        this.updateSelectedTaskVisual();
    }

    // Restore selection index from stored task ID
    restoreSelectionById() {
        if (!this.isKeyboardNavActive || !this.selectedTaskId) return;

        const todos = this.getFilteredTodos();

        // Handle empty list case
        if (todos.length === 0) {
            this.selectedTaskIndex = -1;
            this.selectedTaskId = null;
            return;
        }

        const newIndex = todos.findIndex(t => t.id === this.selectedTaskId);

        if (newIndex !== -1) {
            this.selectedTaskIndex = newIndex;
        } else {
            // Task was removed, clamp index to valid range
            this.selectedTaskIndex = Math.min(this.selectedTaskIndex, todos.length - 1);
            this.selectedTaskIndex = Math.max(this.selectedTaskIndex, 0);
            // Update the stored ID to the new task at this index
            this.selectedTaskId = todos[this.selectedTaskIndex]?.id || null;
        }
    }

    renderKeyboardHint(container) {
        if (!this.data.settings.enableKeyboardNavigation || !this.isKeyboardNavActive) return;

        const hint = container.createDiv({ cls: 'todo-keyboard-hint' });
        hint.innerHTML = `<kbd>j/k</kbd> navigate <kbd>x</kbd> complete <kbd>e</kbd> edit <kbd>d</kbd> delete <kbd>m</kbd> move <kbd>Esc</kbd> exit`;
    }

    renderSidebar(container) {
        const sidebar = container.createDiv({ cls: 'todo-sidebar' });
        
        // Sidebar search
        const sidebarSearch = sidebar.createDiv({ cls: 'todo-sidebar-search' });
        const searchInput = sidebarSearch.createEl('input', {
            type: 'text',
            placeholder: 'Filter lists...',
            cls: 'todo-sidebar-search-input'
        });
        
        let sidebarFilter = '';
        searchInput.addEventListener('input', (e) => {
            sidebarFilter = e.target.value.toLowerCase();
            updateSidebarVisibility();
        });
        
        const updateSidebarVisibility = () => {
            sidebar.querySelectorAll('.todo-sidebar-item[data-filterable]').forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(sidebarFilter) ? '' : 'none';
            });
        };
        
        // Smart Lists
        const smartSection = sidebar.createDiv({ cls: 'todo-sidebar-section' });
        smartSection.createDiv({ cls: 'todo-sidebar-title', text: 'Smart Lists' });

        for (const [key, smartList] of Object.entries(SMART_LISTS)) {
            const count = this.getSmartListCount(key);
            const item = smartSection.createDiv({
                cls: `todo-sidebar-item ${this.currentSmartList === key ? 'active' : ''}`,
                attr: { 'data-filterable': 'true', 'data-action': 'select-smart-list', 'data-smart-list': key }
            });
            item.innerHTML = `${this.getIcon(smartList.icon)} <span>${smartList.label}</span>`;
            if (count > 0) {
                item.createSpan({ cls: 'todo-sidebar-count', text: count.toString() });
            }
        }
        
        // Projects
        const listsSection = sidebar.createDiv({ cls: 'todo-sidebar-section' });
        const listsHeader = listsSection.createDiv({ cls: 'todo-sidebar-header' });
        listsHeader.createDiv({ cls: 'todo-sidebar-title', text: 'Projects' });

        const addListBtn = listsHeader.createDiv({
            cls: 'todo-sidebar-add',
            attr: { 'data-action': 'add-list' }
        });
        addListBtn.innerHTML = this.getIcon('plus');

        for (const [id, list] of Object.entries(this.data.lists)) {
            const item = listsSection.createDiv({
                cls: `todo-sidebar-item ${!this.currentSmartList && this.data.currentList === id ? 'active' : ''} ${list.color ? 'has-color' : ''}`,
                attr: { title: list.name, 'data-filterable': 'true', 'data-list-id': id, 'data-action': 'select-list' }
            });

            // Apply project color as left border and subtle background tint
            if (list.color) {
                item.style.borderLeftColor = list.color;
                item.style.setProperty('--project-color', list.color);
            }

            item.innerHTML = `${this.getIcon('folder')} <span>${list.name}</span>`;
            item.createSpan({ cls: 'todo-sidebar-count', text: list.todos.length.toString() });

            // Context menu still uses per-element handler (right-click is rare)
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showListContextMenu(e, id);
            });

            // Drop zone for moving tasks (drag events are complex and not delegated)
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (this.draggedId && id !== this.data.currentList) {
                    item.classList.add('drag-target');
                }
            });
            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-target');
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('drag-target');
                if (this.draggedId) {
                    this.moveTaskToList(this.draggedId, id);
                }
            });
        }
        
        // Tags
        const tags = this.getAllTags();
        if (tags.length > 0) {
            const tagsSection = sidebar.createDiv({ cls: 'todo-sidebar-section' });
            tagsSection.createDiv({ cls: 'todo-sidebar-title', text: 'Tags' });

            tags.forEach(tag => {
                const item = tagsSection.createDiv({
                    cls: `todo-sidebar-item todo-tag-item ${this.filterTag === tag ? 'active' : ''}`,
                    attr: { 'data-filterable': 'true', 'data-action': 'select-tag', 'data-tag': tag }
                });
                // Use safe DOM methods to prevent XSS from user-provided tag names
                item.createSpan({ cls: 'todo-tag-dot' });
                item.createSpan({ text: ' ' });
                item.createSpan({ text: tag });
            });
        }

        // Settings
        const settingsSection = sidebar.createDiv({ cls: 'todo-sidebar-section todo-sidebar-settings' });

        const settingsItem = settingsSection.createDiv({
            cls: 'todo-sidebar-item',
            attr: { 'data-action': 'open-settings' }
        });
        settingsItem.innerHTML = `${this.getIcon('settings')} <span>Settings</span>`;

        if (this.data.settings.fullCalendarSync) {
            const syncStatus = settingsSection.createDiv({ cls: 'todo-sync-status' });
            syncStatus.innerHTML = `${this.getIcon('calendar', 12)} Calendar sync enabled`;
        }

        // Undo indicator
        if (this.undoStack.length > 0) {
            const undoItem = settingsSection.createDiv({
                cls: 'todo-sidebar-item todo-undo-item',
                attr: { 'data-action': 'undo' }
            });
            undoItem.innerHTML = `${this.getIcon('undo')} <span>Undo (${this.undoStack.length})</span>`;
        }
    }

    getSmartListCount(key) {
        let count = 0;
        for (const listId in this.data.lists) {
            count += this.data.lists[listId].todos.filter(SMART_LISTS[key].filter).length;
        }
        return count;
    }

    renderHeader(container) {
        const header = container.createDiv({ cls: 'todo-header' });

        const titleSection = header.createDiv({ cls: 'todo-header-title' });
        const title = this.currentSmartList
            ? SMART_LISTS[this.currentSmartList].label
            : this.getCurrentList().name;
        titleSection.createEl('h4', { text: title });

        // Search
        const searchWrapper = header.createDiv({ cls: 'todo-search-wrapper' });
        searchWrapper.innerHTML = this.getIcon('search');
        const searchInput = searchWrapper.createEl('input', {
            type: 'text',
            placeholder: 'Search tasks... (/)',
            cls: 'todo-search-input',
            value: this.searchQuery
        });
        // Note: input event handled by delegated input handler
        // Note: keydown for Enter/Escape handled by delegated keydown handler

        if (this.searchQuery) {
            const clearBtn = searchWrapper.createDiv({
                cls: 'todo-search-clear',
                attr: { 'data-action': 'clear-search' }
            });
            clearBtn.innerHTML = this.getIcon('x');
        }

        // Sort
        const sortWrapper = header.createDiv({ cls: 'todo-sort-wrapper' });
        const sortBtn = sortWrapper.createDiv({ cls: 'todo-sort-btn' });
        sortBtn.innerHTML = `${this.getIcon('arrow-up-down')} Sort`;

        const sortMenu = sortWrapper.createDiv({ cls: 'todo-sort-menu' });
        const sortOptions = [
            { value: 'manual', label: 'Manual' },
            { value: 'priority', label: 'Priority' },
            { value: 'dueDate', label: 'Due Date' },
            { value: 'created', label: 'Created' }
        ];

        sortOptions.forEach(opt => {
            const item = sortMenu.createDiv({
                cls: `todo-sort-item ${this.data.settings.sortBy === opt.value ? 'active' : ''}`,
                text: opt.label,
                attr: { 'data-action': 'set-sort', 'data-sort-value': opt.value }
            });
        });
    }

    renderActiveFilters(container) {
        if (!this.filterTag && !this.searchQuery) return;

        const filters = container.createDiv({ cls: 'todo-active-filters' });

        if (this.filterTag) {
            const tag = filters.createDiv({
                cls: 'todo-filter-chip',
                attr: { 'data-action': 'clear-filter-tag' }
            });
            tag.createSpan({ text: `${this.filterTag} ` });
            tag.innerHTML += this.getIcon('x');
        }

        if (this.searchQuery) {
            const search = filters.createDiv({
                cls: 'todo-filter-chip',
                attr: { 'data-action': 'clear-filter-search' }
            });
            search.createSpan({ text: `Search: "${this.searchQuery}" ` });
            search.innerHTML += this.getIcon('x');
        }
    }

    renderInputSection(container) {
        if (this.currentSmartList) return;

        const inputSection = container.createDiv({ cls: 'todo-input-section' });

        const inputWrapper = inputSection.createDiv({ cls: 'todo-input-wrapper' });
        const input = inputWrapper.createEl('input', {
            type: 'text',
            placeholder: 'Add a task... (try: "Meeting tomorrow at 3pm #work")',
            cls: 'todo-input'
        });
        // Note: keydown handled by delegated keydown handler

        const addBtn = inputWrapper.createEl('button', {
            cls: 'todo-add-btn',
            attr: { 'data-action': 'add-task' }
        });
        addBtn.innerHTML = this.getIcon('plus');

        const hint = inputSection.createDiv({ cls: 'todo-input-hint' });
        hint.innerHTML = `<kbd>Enter</kbd> details · <kbd>Ctrl+Shift+Enter</kbd> quick add · <kbd>n</kbd> focus`;
    }

    // Quick add todo - parses natural language dates and times
    async quickAddTodo(text) {
        const tags = extractTags(text);
        let dueDate = null;
        let startTime = null;
        let allDay = true;
        let cleanText = text;

        // Enhanced date patterns including time
        const datePatterns = [
            /\s+(today|tomorrow|tmr|tom)(\s+at\s+\d{1,2}(?:\:\d{2})?\s*(?:am|pm)?)?$/i,
            /\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+at\s+\d{1,2}(?:\:\d{2})?\s*(?:am|pm)?)?$/i,
            /\s+next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
            /\s+in\s+(\d+)\s+days?$/i,
            /\s+at\s+(\d{1,2})(?:\:(\d{2}))?\s*(am|pm)?$/i,
            /\s+(\d{1,2}[\/\-]\d{1,2})$/
        ];

        for (const pattern of datePatterns) {
            const match = cleanText.match(pattern);
            if (match) {
                const parsedDate = parseNaturalDateTime(match[0].trim());
                if (parsedDate) {
                    dueDate = parsedDate.toISOString();
                    // Check if time was included
                    if (parsedDate.getHours() !== 0 || parsedDate.getMinutes() !== 0) {
                        allDay = false;
                        startTime = formatTimeForCalendar(parsedDate.getHours(), parsedDate.getMinutes());
                    }
                    cleanText = cleanText.replace(pattern, '');
                    break;
                }
            }
        }

        const task = {
            id: generateId(),
            text: cleanText.trim(),
            createdAt: Date.now(),
            priority: 'none',
            dueDate: dueDate,
            startTime: startTime,
            endTime: startTime ? this.getDefaultEndTime(startTime) : null,
            allDay: allDay,
            recurrence: null,
            recurrenceEndDate: null,
            tags: tags,
            subtasks: [],
            notes: '',
            linkedNote: null,
            calendarEventPath: null
        };

        const currentListId = this.data.currentList;
        this.getCurrentList().todos.unshift(task);

        if (this.data.settings.fullCalendarSync && dueDate) {
            await this.syncTaskToCalendar(task);
        }

        // Push to undo stack AFTER adding (so we have the calendarEventPath if created)
        this.pushUndo('add', { task: this.cloneTask(task), listId: currentListId });

        await this.saveData();
        this.render();
        new Notice('Task added (Ctrl+Z to undo)');
    }

    async showAddTaskModal(initialText = '') {
        const modal = new TaskEditModal(this.app, this.plugin, null, initialText, async (task) => {
            if (task) {
                const currentListId = this.data.currentList;
                this.getCurrentList().todos.unshift(task);

                if (this.data.settings.fullCalendarSync && task.dueDate) {
                    await this.syncTaskToCalendar(task);
                }

                // Push to undo stack AFTER adding (so we have the calendarEventPath if created)
                this.pushUndo('add', { task: this.cloneTask(task), listId: currentListId });

                await this.saveData();
                this.render();
                new Notice('Task added (Ctrl+Z to undo)');
            }
        });
        modal.open();
    }

    renderTodosList(container) {
        const todos = this.getFilteredTodos();
        const todosSection = container.createDiv({ cls: 'todo-section' });
        
        if (todos.length === 0) {
            const emptyState = todosSection.createDiv({ cls: 'todo-empty-state' });
            
            let emptyTitle = 'No tasks yet';
            let emptyMessage = 'Add your first task above';
            let emptyIcon = 'check-circle';
            
            if (this.searchQuery || this.filterTag) {
                emptyTitle = 'No matching tasks';
                emptyMessage = 'Try a different search or filter';
                emptyIcon = 'search';
            } else if (this.currentSmartList && SMART_LISTS[this.currentSmartList]) {
                emptyTitle = SMART_LISTS[this.currentSmartList].emptyTitle;
                emptyMessage = SMART_LISTS[this.currentSmartList].emptyMessage;
            }
            
            emptyState.innerHTML = `
                ${this.getIcon(emptyIcon, 48)}
                <p>${emptyTitle}</p>
                <span>${emptyMessage}</span>
            `;
            return;
        }
        
        const todoList = todosSection.createDiv({ cls: 'todo-list' });
        todos.forEach((todo, index) => {
            this.renderTodoItem(todoList, todo, index, false);
        });
    }

    renderTodoItem(container, todo, index, isArchived, isSubtask = false, parentId = null) {
        // Guard against null/undefined todo
        if (!todo || !todo.id) {
            console.warn('renderTodoItem called with invalid todo:', todo);
            return;
        }

        const taskIsOverdue = !isArchived && isOverdue(todo.dueDate);
        const isExpanded = this.expandedTasks.has(todo.id);
        const hasSubtasks = todo.subtasks && todo.subtasks.length > 0;
        const hasNotes = todo.notes && todo.notes.trim().length > 0;
        const completedSubtasks = hasSubtasks ? todo.subtasks.filter(s => s.completed).length : 0;
        
        // Disable drag/drop on touch devices to prevent conflicts with scrolling
        const canDrag = !isArchived && !isSubtask && !this.isTouchDevice;

        const item = container.createDiv({
            cls: `todo-item ${isArchived ? 'archived' : ''} ${isSubtask ? 'subtask' : ''} ${isSubtask && todo.completed ? 'completed' : ''} ${taskIsOverdue ? 'overdue' : ''} priority-${todo.priority || 'none'}`,
            attr: {
                'data-id': todo.id,
                'data-index': index,
                'draggable': canDrag,
                ...(isSubtask && parentId ? { 'data-parent-id': parentId } : {})
            }
        });

        if (canDrag) {
            item.addEventListener('dragstart', (e) => this.handleDragStart(e, todo.id));
            item.addEventListener('dragend', (e) => this.handleDragEnd(e));
            item.addEventListener('dragover', (e) => this.handleDragOver(e));
            item.addEventListener('drop', (e) => this.handleDrop(e, todo.id));
        }

        const mainRow = item.createDiv({ cls: 'todo-item-main' });
        
        // Expand button (only for tasks with subtasks or notes)
        if ((hasSubtasks || hasNotes) && !isSubtask) {
            const expandBtn = mainRow.createDiv({
                cls: 'todo-expand-btn',
                attr: { 'data-action': 'expand', 'data-task-id': todo.id }
            });
            expandBtn.innerHTML = isExpanded ? this.getIcon('chevron-down') : this.getIcon('chevron-right');
        } else if (!isSubtask) {
            mainRow.createDiv({ cls: 'todo-expand-placeholder' });
        }

        const checkbox = mainRow.createDiv({ cls: 'todo-checkbox-wrapper' });
        const checkboxInput = checkbox.createEl('input', {
            type: 'checkbox',
            cls: 'todo-checkbox',
            attr: { checked: isArchived || (isSubtask && todo.completed) }
        });

        const checkmark = checkbox.createDiv({ cls: 'todo-checkmark' });
        checkmark.innerHTML = this.getIcon('check', 12);
        // Note: checkbox change is handled by delegated event handler

        const content = mainRow.createDiv({ cls: 'todo-content' });
        
        const textSpan = content.createDiv({ cls: 'todo-text' });
        // Use safe rendering to prevent XSS
        textSpan.innerHTML = renderTaskTextSafe(todo.text, todo.tags, this.searchQuery);
        
        const meta = content.createDiv({ cls: 'todo-meta' });
        
        if (todo.dueDate) {
            const dueDateEl = meta.createSpan({ cls: `todo-due-date ${taskIsOverdue ? 'overdue' : ''}` });
            dueDateEl.innerHTML = `${this.getIcon('calendar', 12)} ${formatDateTime(todo.dueDate)}`;
            
            if (todo.recurrence) {
                dueDateEl.innerHTML += ` ${this.getIcon('repeat', 10)}`;
            }
        }
        
        if (hasSubtasks && !isSubtask) {
            const progress = meta.createSpan({ cls: 'todo-subtask-progress' });
            progress.innerHTML = `${this.getIcon('list-checks', 12)} ${completedSubtasks}/${todo.subtasks.length}`;
        }
        
        if (todo.linkedNote && !isSubtask) {
            const linkedNoteEl = meta.createSpan({
                cls: 'todo-linked-note',
                attr: {
                    'data-action': 'open-linked-note',
                    'data-note-path': todo.linkedNote,
                    'title': todo.linkedNote
                }
            });
            const displayName = todo.linkedNote.replace(/\.md$/, '').split('/').pop();
            linkedNoteEl.innerHTML = `${this.getIcon('file-text', 12)} ${displayName}`;
        }

        const actions = mainRow.createDiv({ cls: 'todo-actions' });

        if (!isArchived && !isSubtask) {
            const editBtn = actions.createEl('button', {
                cls: 'todo-action-btn',
                attr: { 'aria-label': 'Edit (e)', 'data-action': 'edit', 'data-task-id': todo.id }
            });
            editBtn.innerHTML = this.getIcon('edit', 14);

            const priorityBtn = actions.createEl('button', {
                cls: `todo-action-btn todo-priority-btn priority-${todo.priority || 'none'}`,
                attr: { 'aria-label': 'Set priority (p)', 'data-action': 'priority', 'data-task-id': todo.id }
            });
            priorityBtn.innerHTML = this.getIcon('flag', 14);

            const linkBtn = actions.createEl('button', {
                cls: `todo-action-btn todo-link-btn ${todo.linkedNote ? 'has-link' : ''}`,
                attr: { 'aria-label': 'Link to note', 'data-action': 'link', 'data-task-id': todo.id }
            });
            linkBtn.innerHTML = this.getIcon('file-text', 14);

            // Move button
            const moveBtn = actions.createEl('button', {
                cls: 'todo-action-btn',
                attr: { 'aria-label': 'Move to list (m)', 'data-action': 'move', 'data-task-id': todo.id }
            });
            moveBtn.innerHTML = this.getIcon('move', 14);
        }

        // Delete button - action depends on context
        const deleteAction = isSubtask ? 'delete-subtask' : (isArchived ? 'delete-archived' : 'delete');
        const deleteAttrs = {
            'aria-label': 'Delete (d)',
            'data-action': deleteAction,
            'data-task-id': todo.id
        };
        if (isSubtask && parentId) {
            deleteAttrs['data-parent-id'] = parentId;
        }
        const deleteBtn = actions.createEl('button', {
            cls: 'todo-action-btn todo-delete-btn',
            attr: deleteAttrs
        });
        deleteBtn.innerHTML = this.getIcon('trash-2', 14);

        if (!isArchived && !isSubtask) {
            const dragHandle = actions.createDiv({ cls: 'todo-drag-handle' });
            dragHandle.innerHTML = this.getIcon('grip-vertical', 14);
        }

        if (isExpanded && !isSubtask) {
            const expandedContent = item.createDiv({ cls: 'todo-expanded-content' });
            
            if (hasNotes) {
                const notesSection = expandedContent.createDiv({ cls: 'todo-notes-section' });
                const notesContent = notesSection.createDiv({ cls: 'todo-notes-content' });
                // Use linked note path for proper wiki-link resolution, or active file, or empty string
                const sourcePath = todo.linkedNote || this.app.workspace.getActiveFile()?.path || '';
                MarkdownRenderer.renderMarkdown(todo.notes, notesContent, sourcePath, this);
            }
            
            if (hasSubtasks) {
                const subtasksSection = expandedContent.createDiv({ cls: 'todo-subtasks-section' });
                todo.subtasks.forEach((subtask, subIndex) => {
                    this.renderTodoItem(subtasksSection, subtask, subIndex, false, true, todo.id);
                });
            }
            
            if (!isArchived) {
                const addSubtaskWrapper = expandedContent.createDiv({ cls: 'todo-add-subtask' });
                const addSubtaskInput = addSubtaskWrapper.createEl('input', {
                    type: 'text',
                    placeholder: 'Add subtask...',
                    cls: 'todo-subtask-input',
                    attr: { 'data-parent-task-id': todo.id }
                });
                // Note: keydown handled by delegated keydown handler
            }
        }
    }

    renderArchivedSection(container) {
        const archived = this.getFilteredArchived();
        if (archived.length === 0) return;

        const archivedSection = container.createDiv({ cls: 'todo-archived-section' });

        const archivedHeader = archivedSection.createDiv({
            cls: 'todo-archived-header',
            attr: { 'data-action': 'toggle-archived' }
        });

        const archivedTitle = archivedHeader.createDiv({ cls: 'todo-archived-title' });
        archivedTitle.innerHTML = this.data.settings.showArchived
            ? this.getIcon('chevron-down')
            : this.getIcon('chevron-right');
        archivedTitle.createSpan({ text: ' Completed' });

        archivedHeader.createSpan({ cls: 'todo-archived-count', text: archived.length.toString() });

        const clearBtn = archivedHeader.createEl('button', {
            cls: 'todo-clear-archived-btn',
            attr: { 'data-action': 'clear-archived' }
        });
        clearBtn.innerHTML = this.getIcon('trash-2', 14);

        if (this.data.settings.showArchived) {
            const archivedList = archivedSection.createDiv({ cls: 'todo-list todo-archived-list' });
            archived.forEach((todo, index) => {
                this.renderTodoItem(archivedList, todo, index, true);
            });
        }
    }

    renderContent() {
        const container = this.containerEl.querySelector('.todo-main-content');
        if (!container) return; 
        
        const todoSection = container.querySelector('.todo-section');
        const archivedSection = container.querySelector('.todo-archived-section');
        const activeFilters = container.querySelector('.todo-active-filters');
        const keyboardHint = container.querySelector('.todo-keyboard-hint');
        
        if (todoSection) todoSection.remove();
        if (archivedSection) archivedSection.remove();
        if (activeFilters) activeFilters.remove();
        if (keyboardHint) keyboardHint.remove();
        
        const inputSection = container.querySelector('.todo-input-section');
        const insertPoint = inputSection || container.querySelector('.todo-header');
        
        // Re-render keyboard hint
        if (this.isKeyboardNavActive) {
            const hint = document.createElement('div');
            hint.className = 'todo-keyboard-hint';
            hint.innerHTML = `<kbd>j/k</kbd> navigate <kbd>x</kbd> complete <kbd>e</kbd> edit <kbd>d</kbd> delete <kbd>m</kbd> move <kbd>Esc</kbd> exit`;
            if (insertPoint && insertPoint.nextSibling) {
                container.insertBefore(hint, insertPoint.nextSibling);
            }
        }
        
        // Re-render active filters
        if (this.filterTag || this.searchQuery) {
            const filterWrapper = document.createElement('div');
            filterWrapper.className = 'todo-active-filters';
            
            if (this.filterTag) {
                const tag = filterWrapper.createDiv({ cls: 'todo-filter-chip' });
                tag.createSpan({ text: `${this.filterTag} ` });
                tag.innerHTML += this.getIcon('x');
                tag.addEventListener('click', () => {
                    this.filterTag = null;
                    this.render();
                });
            }

            if (this.searchQuery) {
                const search = filterWrapper.createDiv({ cls: 'todo-filter-chip' });
                search.createSpan({ text: `Search: "${this.searchQuery}" ` });
                search.innerHTML += this.getIcon('x');
                search.addEventListener('click', () => {
                    this.searchQuery = '';
                    this.render();
                });
            }
            
            container.appendChild(filterWrapper);
        }
        
        this.renderTodosList(container);
        this.renderArchivedSection(container);
        this.updateSelectedTaskVisual();
    }

    // Task operations with animations
    async archiveTodo(id) {
        // Guard against rapid double-clicks during animation
        if (!this._archivingIds) this._archivingIds = new Set();
        if (this._archivingIds.has(id)) return;
        this._archivingIds.add(id);

        try {
            const listId = this.getListIdForTask(id);
            if (!listId) return;

            const list = this.data.lists[listId];
            const index = list.todos.findIndex(t => t.id === id);
            if (index === -1) return;

            // Animate completion (if enabled)
            if (this.data.settings.enableAnimations) {
                const item = this.containerEl.querySelector(`.todo-item[data-id="${id}"]`);
                if (item) {
                    item.classList.add('completing');
                    await new Promise(resolve => setTimeout(resolve, CONFIG.ANIMATION_DURATION_MS));
                }
            }

            const [todo] = list.todos.splice(index, 1);
            todo.completedAt = Date.now();
            list.archived.unshift(todo);

            // Push to undo stack
            this.pushUndo('complete', { task: this.cloneTask(todo), listId });

            // Handle calendar updates based on task type
            const isRecurringCalendarType = todo.recurrence && (todo.recurrence === 'daily' || todo.recurrence === 'weekly');

            if (this.data.settings.fullCalendarSync && todo.calendarEventPath) {
                if (isRecurringCalendarType) {
                    // For daily/weekly recurring: create a completed single event for history
                    await this.createCompletedCalendarEvent(todo);
                } else {
                    // For non-recurring tasks, mark as completed
                    this.updateCalendarEventCompletion(todo, true);
                }
            }

            // Handle recurring
            if (todo.recurrence) {
                const nextDue = getNextRecurrence(todo.dueDate, todo.recurrence, todo.recurrenceEndDate);
                if (nextDue) {
                    // For daily/weekly recurring tasks, inherit the calendarEventPath
                    // so we update the same recurring file instead of creating duplicates
                    const newTask = {
                        ...todo,
                        id: generateId(),
                        dueDate: nextDue,
                        completedAt: undefined,
                        notified: false,
                        notified15: false,
                        calendarEventPath: isRecurringCalendarType ? todo.calendarEventPath : null,
                        subtasks: todo.subtasks.map(s => ({ ...s, completed: false }))
                    };
                    list.todos.unshift(newTask);

                    if (this.data.settings.fullCalendarSync) {
                        // This will update the recurring file's startRecur to the next date
                        // or create a new file for other recurrence types
                        await this.syncTaskToCalendar(newTask);
                    }

                    new Notice('Recurring task created for ' + formatDateTime(nextDue));
                } else {
                    // Recurrence has ended - clean up the calendar file
                    if (this.data.settings.fullCalendarSync && todo.calendarEventPath && isRecurringCalendarType) {
                        await this.removeTaskFromCalendar(todo);
                    }
                    new Notice('Recurring task series completed! 🎉');
                }
            }

            // Adjust selection index to stay in bounds (use filtered list for smart lists/filters)
            const filteredTodos = this.getFilteredTodos();
            if (this.selectedTaskIndex >= filteredTodos.length) {
                this.selectedTaskIndex = Math.max(0, filteredTodos.length - 1);
            }
            // Update selected ID to match new index position
            this.selectedTaskId = filteredTodos[this.selectedTaskIndex]?.id || null;

            await this.saveData();
            this.render();
            new Notice('Task completed! 🎉 (Ctrl+Z to undo)');
        } finally {
            this._archivingIds.delete(id);
        }
    }

    async unarchiveTodo(id) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const index = list.archived.findIndex(t => t.id === id);
            if (index !== -1) {
                const [todo] = list.archived.splice(index, 1);
                delete todo.completedAt;
                list.todos.unshift(todo);
                
                if (this.data.settings.fullCalendarSync && todo.calendarEventPath) {
                    this.updateCalendarEventCompletion(todo, false);
                }
                
                await this.saveData();
                this.render();
                new Notice('Task restored');
                return;
            }
        }
    }

    async deleteTodoWithConfirm(id) {
        if (!this.data.settings.enableConfirmDialogs) {
            await this.deleteTodo(id);
            return;
        }
        const modal = new ConfirmModal(
            this.app,
            'Delete Task',
            'Are you sure you want to delete this task? You can undo this action.',
            async () => {
                await this.deleteTodo(id);
            }
        );
        modal.open();
    }

    async deleteTodo(id) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const index = list.todos.findIndex(t => t.id === id);
            if (index !== -1) {
                const [todo] = list.todos.splice(index, 1);
                
                // Push to undo stack
                this.pushUndo('delete', { task: this.cloneTask(todo), listId });
                
                if (todo.calendarEventPath) {
                    await this.removeTaskFromCalendar(todo);
                }

                // Adjust selection index to stay in bounds (use filtered list for smart lists/filters)
                const filteredTodos = this.getFilteredTodos();
                if (this.selectedTaskIndex >= filteredTodos.length) {
                    this.selectedTaskIndex = Math.max(0, filteredTodos.length - 1);
                }
                // Update selected ID to match new index position
                this.selectedTaskId = filteredTodos[this.selectedTaskIndex]?.id || null;

                await this.saveData();
                this.render();
                new Notice('Task deleted (Ctrl+Z to undo)');
                return;
            }
        }
    }

    async deleteArchived(id) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const index = list.archived.findIndex(t => t.id === id);
            if (index !== -1) {
                const [todo] = list.archived.splice(index, 1);

                // Push to undo stack before removing calendar file
                this.pushUndo('delete-archived', { task: this.cloneTask(todo), listId });

                if (todo.calendarEventPath) {
                    await this.removeTaskFromCalendar(todo);
                }

                await this.saveData();
                this.render();
                new Notice('Completed task deleted (Ctrl+Z to undo)');
                return;
            }
        }
    }

    async clearArchivedWithConfirm() {
        if (!this.data.settings.enableConfirmDialogs) {
            await this.clearArchived();
            return;
        }
        const count = this.getFilteredArchived().length;
        const modal = new ConfirmModal(
            this.app,
            'Clear Completed Tasks',
            `Delete ${count} completed task${count !== 1 ? 's' : ''}? You can undo this action.`,
            async () => {
                await this.clearArchived();
            }
        );
        modal.open();
    }

    async clearArchived() {
        // Collect all tasks to be cleared for undo support
        const tasksToUndo = [];

        // Clear archived tasks but preserve calendar files for history
        // Calendar events for completed tasks remain visible in the calendar
        if (this.currentSmartList) {
            for (const listId in this.data.lists) {
                const archived = this.data.lists[listId].archived;
                for (const task of archived) {
                    tasksToUndo.push({ task: this.cloneTask(task), listId });
                }
                this.data.lists[listId].archived = [];
            }
        } else {
            const currentListId = this.data.currentList;
            const archived = this.getCurrentList().archived;
            for (const task of archived) {
                tasksToUndo.push({ task: this.cloneTask(task), listId: currentListId });
            }
            this.getCurrentList().archived = [];
        }

        // Push batch undo action if we cleared any tasks
        if (tasksToUndo.length > 0) {
            this.pushUndo('clear-archived-batch', { tasks: tasksToUndo });
        }

        await this.saveData();
        this.render();
        new Notice(`Cleared ${tasksToUndo.length} completed task${tasksToUndo.length !== 1 ? 's' : ''} (Ctrl+Z to undo)`);
    }

    editTodo(todo) {
        const modal = new TaskEditModal(this.app, this.plugin, todo, '', async (updatedTask) => {
            if (updatedTask) {
                for (const listId in this.data.lists) {
                    const list = this.data.lists[listId];
                    const index = list.todos.findIndex(t => t.id === todo.id);
                    if (index !== -1) {
                        // Push to undo stack BEFORE modifying
                        this.pushUndo('edit', { task: this.cloneTask(list.todos[index]), listId });

                        const task = { ...list.todos[index], ...updatedTask };
                        list.todos[index] = task;

                        if (this.data.settings.fullCalendarSync) {
                            if (task.dueDate) {
                                await this.syncTaskToCalendar(task);
                            } else if (task.calendarEventPath) {
                                await this.removeTaskFromCalendar(task);
                            }
                        }

                        await this.saveData();
                        this.render();
                        new Notice('Task updated (Ctrl+Z to undo)');
                        return;
                    }
                }
            }
        });
        modal.open();
    }

    showMoveTaskModal(todo) {
        if (Object.keys(this.data.lists).length <= 1) {
            new Notice('Create another list first to move tasks');
            return;
        }
        
        const currentListId = this.getListIdForTask(todo.id);
        const modal = new ListSelectorModal(this.app, this.data.lists, currentListId, async (targetListId) => {
            await this.moveTaskToList(todo.id, targetListId);
        });
        modal.setPlaceholder('Select destination list...');
        modal.open();
    }

    async moveTaskToList(taskId, targetListId) {
        const sourceListId = this.getListIdForTask(taskId);
        if (!sourceListId || sourceListId === targetListId) return;

        const sourceList = this.data.lists[sourceListId];
        const targetList = this.data.lists[targetListId];

        // Validate both lists exist
        if (!sourceList || !targetList) {
            new Notice('Error: List not found');
            return;
        }

        const index = sourceList.todos.findIndex(t => t.id === taskId);
        if (index === -1) return;

        const [task] = sourceList.todos.splice(index, 1);
        targetList.todos.unshift(task);
        
        // Push to undo stack
        this.pushUndo('move', { task: this.cloneTask(task), fromList: sourceListId, toList: targetListId });

        await this.saveData();
        this.render();
        new Notice(`Moved to "${targetList.name}" (Ctrl+Z to undo)`);
    }

    openLinkedNote(notePath) {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (file) {
            this.app.workspace.openLinkText(notePath, '', false);
        } else {
            new Notice(`Note not found: ${notePath}`);
        }
    }

    quickLinkNote(todo) {
        const modal = new NoteSuggestModal(this.app, (file) => {
            for (const listId in this.data.lists) {
                const list = this.data.lists[listId];
                const task = list.todos.find(t => t.id === todo.id);
                if (task) {
                    task.linkedNote = file.path;
                    this.saveData();
                    this.render();
                    new Notice(`Linked to: ${file.basename}`);
                    return;
                }
            }
        });
        modal.open();
    }

    // =========================================
    // FULL CALENDAR INTEGRATION
    // =========================================

    // Sync task to Full Calendar (creates/updates markdown event file)
    async syncTaskToCalendar(task) {
        if (!this.data.settings.fullCalendarSync || !task.dueDate) return;

        // All calendar files go to a single folder
        const folder = this.data.settings.fullCalendarFolder || 'calendar/tasks';

        // Validate folder path to prevent directory traversal attacks
        if (!validatePath(folder)) {
            console.error('Invalid calendar folder path:', folder);
            new Notice('Calendar folder path is invalid. Please check settings.');
            return;
        }

        // Validate task has required properties
        if (!task.text) {
            console.error('Task missing text property:', task);
            return;
        }

        this.setLoading(true);

        // Ensure folder hierarchy exists
        try {
            const parts = folder.split('/');
            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                try {
                    const existing = this.app.vault.getAbstractFileByPath(currentPath);
                    if (!existing) {
                        await this.app.vault.createFolder(currentPath);
                    } else if (existing.children === undefined) {
                        // Path exists but is a file, not a folder
                        console.error('Calendar path blocked by file:', currentPath);
                        new Notice(`Cannot create calendar folder: "${currentPath}" exists as a file`);
                        this.setLoading(false);
                        return;
                    }
                } catch (err) {
                    // Only ignore "folder already exists" errors
                    if (!err.message?.includes('Folder already exists')) {
                        console.warn('Error creating folder:', currentPath, err);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to create calendar folder:', e);
            new Notice('Failed to create calendar folder: ' + e.message);
            this.setLoading(false);
            return;
        }

        const dueDate = new Date(task.dueDate);
        
        // Validate date is valid
        if (isNaN(dueDate.getTime())) {
            console.error('Invalid due date:', task.dueDate);
            this.setLoading(false);
            return;
        }
        
        const dateStr = formatDateForCalendar(dueDate);
        
        // Use explicit allDay field, or infer from startTime
        const isAllDay = task.allDay !== false && !task.startTime;

        // Sanitize title for filename
        let sanitizedTitle = (task.text || 'Task').replace(/[\\/:*?"<>|#^\[\]]/g, '').trim().slice(0, 40);
        if (!sanitizedTitle) sanitizedTitle = 'Task';

        // For recurring tasks, use a stable filename (without date) so we can update in place
        // For single events, include the date in the filename
        const isRecurringType = task.recurrence && (task.recurrence === 'daily' || task.recurrence === 'weekly');
        let fileName;
        const shortId = task.id.slice(-6);
        if (isRecurringType) {
            // Use task ID for uniqueness since title might not be unique
            fileName = `recurring-${sanitizedTitle}-${shortId}.md`;
        } else {
            // Include task ID to prevent collision when same task name on same date
            fileName = `${dateStr} ${sanitizedTitle}-${shortId}.md`;
        }

        // If task already has a calendar path (recurring task being updated), use that path
        const filePath = (isRecurringType && task.calendarEventPath)
            ? task.calendarEventPath
            : `${folder}/${fileName}`;
        
        const priorityEmoji = {
            'high': '🔴 ',
            'medium': '🟡 ',
            'low': '🟢 ',
            'none': ''
        }[task.priority || 'none'];
        
        // Build frontmatter according to Full Calendar spec
        let frontmatter = {};

        if (task.recurrence && (task.recurrence === 'daily' || task.recurrence === 'weekly')) {
            // Recurring event format - shows on all applicable days for planning
            // Full Calendar recurring events have specific required fields
            frontmatter.title = `${priorityEmoji}${task.text}`;
            frontmatter.type = 'recurring';

            // Map recurrence to daysOfWeek
            const DAY_CODES = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
            const dayOfWeek = dueDate.getDay();

            if (task.recurrence === 'daily') {
                frontmatter.daysOfWeek = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
            } else if (task.recurrence === 'weekly') {
                frontmatter.daysOfWeek = [DAY_CODES[dayOfWeek]];
            }

            frontmatter.startRecur = dateStr;
            // Use user-specified end date, or default to 1 year from start
            if (task.recurrenceEndDate) {
                frontmatter.endRecur = formatDateForCalendar(new Date(task.recurrenceEndDate));
            } else {
                const endRecur = new Date(dueDate);
                endRecur.setFullYear(endRecur.getFullYear() + 1);
                frontmatter.endRecur = formatDateForCalendar(endRecur);
            }

            // Add times if not all-day
            if (!isAllDay && task.startTime) {
                frontmatter.startTime = task.startTime;
                frontmatter.endTime = task.endTime || this.getDefaultEndTime(task.startTime);
            }

            frontmatter.allDay = isAllDay;
        } else {
            // Single event format (non-recurring tasks)
            frontmatter.title = `${priorityEmoji}${task.text}`;
            frontmatter.allDay = isAllDay;
            frontmatter.completed = null;
            frontmatter.type = 'single';
            frontmatter.date = dateStr;

            // Add times if not all-day
            if (!isAllDay && task.startTime) {
                frontmatter.startTime = task.startTime;
                frontmatter.endTime = task.endTime || this.getDefaultEndTime(task.startTime);
            }
        }
        
        // Build YAML frontmatter string with proper formatting
        const content = this.buildCalendarFileContent(frontmatter, task);

        // Store old path for cleanup after successful write
        const oldCalendarPath = task.calendarEventPath;
        const pathChanged = oldCalendarPath && oldCalendarPath !== filePath;

        try {
            // Create/update new file FIRST (before deleting old)
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile) {
                await this.app.vault.modify(existingFile, content);
            } else {
                await this.app.vault.create(filePath, content);
            }

            // Only update path after successful write
            task.calendarEventPath = filePath;

            // Delete old file AFTER successful creation of new file
            if (pathChanged) {
                try {
                    const oldFile = this.app.vault.getAbstractFileByPath(oldCalendarPath);
                    if (oldFile) {
                        await this.app.vault.delete(oldFile);
                    }
                } catch (deleteErr) {
                    // Non-fatal: old file cleanup failed but new file was created
                    console.warn('Failed to delete old calendar file:', oldCalendarPath, deleteErr);
                }
            }
        } catch (e) {
            console.error('Failed to sync task to calendar:', e);
            new Notice('Failed to sync task to calendar: ' + e.message);
            // Don't update calendarEventPath on failure - preserve old path if it exists
        }

        this.setLoading(false);
    }

    // Properly escape a string value for YAML
    escapeYamlString(value) {
        if (value === null || value === undefined) return 'null';
        const str = String(value);

        // Check if quoting is needed
        const needsQuoting =
            // Contains special YAML characters
            /[\x00-\x1f\\:'"#\[\]{}|>&*!?@`%]/.test(str) ||
            // Starts or ends with whitespace
            str.startsWith(' ') || str.endsWith(' ') ||
            // Could be parsed as a special YAML type
            /^(true|false|null|~|yes|no|on|off|\d+\.?\d*|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.nan|-\.inf)$/i.test(str) ||
            // Empty string
            str === '' ||
            // Contains newlines or tabs
            /[\n\r\t]/.test(str);

        if (needsQuoting) {
            // Use double quotes and escape properly
            const escaped = str
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
            return `"${escaped}"`;
        }
        return str;
    }

    // Build properly formatted YAML content for Full Calendar
    buildCalendarFileContent(frontmatter, task) {
        let yamlLines = ['---'];

        for (const [key, value] of Object.entries(frontmatter)) {
            if (value === null) {
                yamlLines.push(`${key}: null`);
            } else if (Array.isArray(value)) {
                // Format array WITHOUT quotes for day codes (Full Calendar requirement)
                yamlLines.push(`${key}: [${value.join(', ')}]`);
            } else if (typeof value === 'boolean') {
                yamlLines.push(`${key}: ${value}`);
            } else if (typeof value === 'string') {
                yamlLines.push(`${key}: ${this.escapeYamlString(value)}`);
            } else {
                yamlLines.push(`${key}: ${value}`);
            }
        }
        yamlLines.push('---');
        
        // Build body content
        let bodyParts = [];
        
        if (task.notes) {
            bodyParts.push(task.notes);
        }
        
        if (task.linkedNote) {
            bodyParts.push(`**Linked Note:** [[${task.linkedNote.replace(/\.md$/, '')}]]`);
        }
        
        if (task.subtasks && task.subtasks.length > 0) {
            const subtaskLines = task.subtasks.map(s => `- [${s.completed ? 'x' : ' '}] ${s.text}`);
            bodyParts.push(`## Subtasks\n${subtaskLines.join('\n')}`);
        }
        
        return `${yamlLines.join('\n')}\n\n${bodyParts.join('\n\n')}`.trim();
    }

    getDefaultEndTime(startTime) {
        // Returns end time 1 hour after start time
        if (!startTime || typeof startTime !== 'string') return null;
        const parts = startTime.split(':');
        if (parts.length < 2) return null;
        const hours = parseInt(parts[0], 10);
        const mins = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(mins)) return null;
        const endHours = (hours + 1) % 24;
        return formatTimeForCalendar(endHours, mins);
    }

    async removeTaskFromCalendar(task) {
        if (!task.calendarEventPath) return; 
        
        try {
            const file = this.app.vault.getAbstractFileByPath(task.calendarEventPath);
            if (file) {
                await this.app.vault.delete(file);
            }
            task.calendarEventPath = null;
        } catch (e) {
            console.error('Failed to remove calendar event:', e);
        }
    }

    async updateCalendarEventCompletion(task, completed) {
        if (!task.calendarEventPath) return; 
        
        try {
            const file = this.app.vault.getAbstractFileByPath(task.calendarEventPath);
            if (file) {
                let content = await this.app.vault.read(file);
                
                // Full Calendar expects completed to be a date string when completed, or null
                const completionValue = completed ? `"${formatDateForCalendar(new Date())}"` : 'null';
                
                // Handle various completed field formats
                if (content.match(/completed:\s*(null|false|true|"[^"]*")/)) {
                    content = content.replace(/completed:\s*(null|false|true|"[^"]*")/, `completed: ${completionValue}`);
                } else {
                    // Add completed field if not present
                    content = content.replace(/^---\n/, `---\ncompleted: ${completionValue}\n`);
                }
                
                await this.app.vault.modify(file, content);
            }
        } catch (e) {
            console.error('Failed to update calendar event:', e);
        }
    }

    // Create a completed single event for a recurring task completion (for history)
    async createCompletedCalendarEvent(task) {
        if (!this.data.settings.fullCalendarSync || !task.dueDate) return;

        // All calendar files go to a single folder
        const folder = this.data.settings.fullCalendarFolder || 'calendar/tasks';

        const dueDate = new Date(task.dueDate);
        const dateStr = formatDateForCalendar(dueDate);
        const isAllDay = task.allDay !== false && !task.startTime;

        // Sanitize title
        let sanitizedTitle = (task.text || 'Task').replace(/[\\/:*?"<>|#^\[\]]/g, '').trim().slice(0, 40);
        if (!sanitizedTitle) sanitizedTitle = 'Task';

        // Create a unique filename for this completed occurrence (include ID to prevent collision)
        const shortId = task.id.slice(-6);
        const fileName = `${dateStr} ${sanitizedTitle}-${shortId} (done).md`;
        const filePath = `${folder}/${fileName}`;

        const priorityEmoji = {
            'high': '🔴 ',
            'medium': '🟡 ',
            'low': '🟢 ',
            'none': ''
        }[task.priority || 'none'];

        // Build frontmatter for a completed single event
        const frontmatter = {
            title: `${priorityEmoji}${task.text}`,
            allDay: isAllDay,
            type: 'single',
            date: dateStr,
            completed: `"${formatDateForCalendar(new Date())}"`
        };

        // Add times if not all-day
        if (!isAllDay && task.startTime) {
            frontmatter.startTime = task.startTime;
            frontmatter.endTime = task.endTime || this.getDefaultEndTime(task.startTime);
        }

        const content = this.buildCalendarFileContent(frontmatter, task);

        // Ensure folder hierarchy exists
        try {
            const parts = folder.split('/');
            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                try {
                    const existing = this.app.vault.getAbstractFileByPath(currentPath);
                    if (!existing) {
                        await this.app.vault.createFolder(currentPath);
                    } else if (existing.children === undefined) {
                        // Path exists but is a file, not a folder
                        console.error('Calendar path blocked by file:', currentPath);
                        return;
                    }
                } catch (err) {
                    if (!err.message?.includes('Folder already exists')) {
                        console.warn('Error creating folder:', currentPath, err);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to create calendar folder:', e);
            return;
        }

        try {
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile) {
                await this.app.vault.modify(existingFile, content);
            } else {
                await this.app.vault.create(filePath, content);
            }
        } catch (e) {
            console.error('Failed to create completed calendar event:', e);
        }
    }

    async syncAllTasksToCalendar() {
        if (!this.data.settings.fullCalendarSync) return; 
        
        this.setLoading(true);
        let count = 0;
        
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            for (const task of list.todos) {
                if (task.dueDate) {
                    await this.syncTaskToCalendar(task);
                    count++;
                }
            }
        }
        
        await this.saveData();
        this.setLoading(false);
        new Notice(`Synced ${count} tasks to Full Calendar`);
    }

    openSettingsModal() {
        const modal = new TodoSettingsModal(this.app, this.data.settings, async (settings, forceResync = false) => {
            const wasEnabled = this.data.settings.fullCalendarSync;
            const isNowEnabled = settings.fullCalendarSync;

            this.data.settings = { ...this.data.settings, ...settings };
            await this.saveData();

            if (forceResync && isNowEnabled) {
                await this.syncAllTasksToCalendar();
            } else if (!wasEnabled && isNowEnabled) {
                await this.syncAllTasksToCalendar();
            }

            this.render();
            new Notice(forceResync ? 'All tasks synced to calendar' : 'Settings saved');
        });
        modal.open();
    }

    cyclePriority(todo) {
        const priorities = ['none', 'low', 'medium', 'high'];
        const currentIndex = priorities.indexOf(todo.priority || 'none');
        todo.priority = priorities[(currentIndex + 1) % priorities.length];
        this.saveData();
        this.render();
    }

    addSubtask(parentId, text) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const task = list.todos.find(t => t.id === parentId);
            if (task) {
                if (!task.subtasks) task.subtasks = [];
                task.subtasks.push({
                    id: generateId(),
                    text: text,
                    completed: false,
                    createdAt: Date.now()
                });
                this.saveData();
                this.render();
                return;
            }
        }
    }

    toggleSubtask(parentId, subtaskId) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const task = list.todos.find(t => t.id === parentId);
            if (task && task.subtasks) {
                const subtask = task.subtasks.find(s => s.id === subtaskId);
                if (subtask) {
                    subtask.completed = !subtask.completed;
                    this.saveData();
                    this.render();
                    return;
                }
            }
        }
    }

    deleteSubtask(parentId, subtaskId) {
        for (const listId in this.data.lists) {
            const list = this.data.lists[listId];
            const task = list.todos.find(t => t.id === parentId);
            if (task && task.subtasks) {
                const index = task.subtasks.findIndex(s => s.id === subtaskId);
                if (index !== -1) {
                    task.subtasks.splice(index, 1);
                    this.saveData();
                    this.render();
                    return;
                }
            }
        }
    }

    createNewList() {
        const modal = new ListModal(this.app, null, null, async (name, color) => {
            if (name) {
                const id = generateId();
                this.data.lists[id] = { name, color, todos: [], archived: [] };
                this.data.currentList = id;
                this.currentSmartList = null;
                this.saveData();
                this.render();
                new Notice(`Created project: ${name}`);
            }
        });
        modal.open();
    }

    showListContextMenu(e, listId) {
        const menu = new Menu();
        
        menu.addItem((item) => {
            item.setTitle('Edit')
                .setIcon('edit')
                .onClick(() => {
                    const list = this.data.lists[listId];
                    const modal = new ListModal(this.app, list.name, list.color, async (name, color) => {
                        if (name) {
                            list.name = name;
                            list.color = color;
                            this.saveData();
                            this.render();
                        }
                    });
                    modal.open();
                });
        });
        
        if (Object.keys(this.data.lists).length > 1) {
            menu.addItem((item) => {
                item.setTitle('Delete')
                    .setIcon('trash')
                    .onClick(() => {
                        const modal = new ConfirmModal(
                            this.app,
                            'Delete List',
                            `Delete "${this.data.lists[listId].name}" and all its tasks?`,
                            async () => {
                                // Clean up calendar files for all tasks in this list
                                const list = this.data.lists[listId];
                                if (list) {
                                    const allTasks = [...(list.todos || []), ...(list.archived || [])];
                                    for (const task of allTasks) {
                                        if (task.calendarEventPath) {
                                            await this.removeTaskFromCalendar(task);
                                        }
                                    }
                                }
                                delete this.data.lists[listId];
                                if (this.data.currentList === listId) {
                                    this.data.currentList = Object.keys(this.data.lists)[0];
                                }
                                await this.saveData();
                                this.render();
                                new Notice('List deleted');
                            }
                        );
                        modal.open();
                    });
            });
        }
        
        menu.showAtMouseEvent(e);
    }

    // Drag and drop
    handleDragStart(e, id) {
        this.draggedId = id;
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        
        // Create custom drag image
        const dragImage = e.target.cloneNode(true);
        dragImage.style.width = e.target.offsetWidth + 'px';
        dragImage.style.opacity = '0.8';
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 20, 20);
        setTimeout(() => dragImage.remove(), 0);
    }

    handleDragEnd(e) {
        e.target.classList.remove('dragging');
        this.draggedId = null;
        this.containerEl.querySelectorAll('.drag-over, .drag-target').forEach(el => {
            el.classList.remove('drag-over', 'drag-target');
        });
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleDragEnter(e) {
        const item = e.target.closest('.todo-item');
        if (item) item.classList.add('drag-over');
    }

    handleDragLeave(e) {
        const item = e.target.closest('.todo-item');
        if (item) item.classList.remove('drag-over');
    }

    handleDrop(e, targetId) {
        e.preventDefault();
        if (!this.draggedId || this.draggedId === targetId) return;

        // Find actual source lists for both tasks (fixes smart list/filtered view bug)
        const sourceListId = this.getListIdForTask(this.draggedId);
        const targetListId = this.getListIdForTask(targetId);

        // Only allow reorder within the same list
        if (!sourceListId || !targetListId || sourceListId !== targetListId) {
            return;
        }

        const list = this.data.lists[sourceListId];
        const draggedIndex = list.todos.findIndex(t => t.id === this.draggedId);
        const targetIndex = list.todos.findIndex(t => t.id === targetId);

        if (draggedIndex !== -1 && targetIndex !== -1) {
            const [draggedTodo] = list.todos.splice(draggedIndex, 1);
            list.todos.splice(targetIndex, 0, draggedTodo);
            this.saveData();
            this.render();
        }
    }

    getIcon(name, size = 16) {
        const icons = {
            'check': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`, 
            'check-circle': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
            'plus': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
            'x': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
            'edit': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
            'trash-2': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
            'calendar': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
            'calendar-days': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>`,
            'flag': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`,
            'repeat': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`,
            'chevron-right': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
            'chevron-down': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
            'grip-vertical': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>`,
            'search': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
            'inbox': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`,
            'alert-circle': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
            'alert-triangle': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
            'folder': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
            'list-checks': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path></svg>`,
            'arrow-up-down': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"></path><path d="M17 20V4"></path><path d="m3 8 4-4 4 4"></path><path d="M7 4v16"></path></svg>`,
            'file-text': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
            'settings': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
            'move': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3"></path><path d="M9 5l3-3 3 3"></path><path d="M15 19l-3 3-3-3"></path><path d="M19 9l3 3-3 3"></path><path d="M2 12h20"></path><path d="M12 2v20"></path></svg>`,
            'undo': `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`
        };
        return icons[name] || '';
    }
}

// Confirm Modal
class ConfirmModal extends Modal {
    constructor(app, title, message, onConfirm) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('todo-confirm-modal');
        
        contentEl.createEl('h3', { text: this.title });
        contentEl.createEl('p', { text: this.message });
        
        const buttonContainer = contentEl.createDiv({ cls: 'todo-modal-buttons' });
        
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
        
        const confirmBtn = buttonContainer.createEl('button', { 
            text: 'Confirm',
            cls: 'mod-warning'
        });
        confirmBtn.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
        
        // Focus cancel by default
        setTimeout(() => cancelBtn.focus(), 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Task Edit Modal
class TaskEditModal extends Modal {
    constructor(app, plugin, task, initialText, onSubmit) {
        super(app);
        this.plugin = plugin;
        this.task = task;
        this.initialText = initialText;
        this.onSubmit = onSubmit;
        
        this.formData = task ? { ...task } : {
            id: generateId(),
            text: initialText,
            priority: 'none',
            dueDate: null,
            startTime: null,  // HH:MM format
            endTime: null,    // HH:MM format
            allDay: true,
            recurrence: null,
            recurrenceEndDate: null,  // End date for recurring tasks
            tags: extractTags(initialText),
            subtasks: [],
            notes: '',
            linkedNote: null,
            calendarEventPath: null,
            createdAt: Date.now()
        };
        
        // Ensure existing tasks have new fields
        if (task) {
            if (this.formData.allDay === undefined) {
                // Infer allDay from existing dueDate
                if (this.formData.dueDate) {
                    const d = new Date(this.formData.dueDate);
                    this.formData.allDay = d.getHours() === 0 && d.getMinutes() === 0;
                    if (!this.formData.allDay && !this.formData.startTime) {
                        this.formData.startTime = formatTimeForCalendar(d.getHours(), d.getMinutes());
                    }
                } else {
                    this.formData.allDay = true;
                }
            }
            if (!this.formData.startTime) this.formData.startTime = null;
            if (!this.formData.endTime) this.formData.endTime = null;
        }
        
        // Parse initial text for date/time
        if (!task && initialText) {
            const datePatterns = [
                /\s+(today|tomorrow|tmr|tom)(\s+at\s+\d{1,2}(?:\:\d{2})?\s*(?:am|pm)?)?$/i,
                /\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+at\s+\d{1,2}(?:\:\d{2})?\s*(?:am|pm)?)?$/i,
                /\s+next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i
            ];
            
            for (const pattern of datePatterns) {
                const match = initialText.match(pattern);
                if (match) {
                    const parsedDate = parseNaturalDateTime(match[0].trim());
                    if (parsedDate) {
                        this.formData.dueDate = parsedDate.toISOString();
                        this.formData.text = initialText.replace(pattern, '');
                        
                        // Check if time was parsed
                        if (parsedDate.getHours() !== 0 || parsedDate.getMinutes() !== 0) {
                            this.formData.allDay = false;
                            this.formData.startTime = formatTimeForCalendar(parsedDate.getHours(), parsedDate.getMinutes());
                        }
                        break;
                    }
                }
            }
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('todo-task-modal');
        
        contentEl.createEl('h2', { text: this.task ? 'Edit Task' : 'Add Task' });
        
        new Setting(contentEl)
            .setName('Task')
            .addText(text => {
                text.setPlaceholder('What needs to be done?')
                    .setValue(this.formData.text)
                    .onChange(value => {
                        this.formData.text = value;
                        this.formData.tags = extractTags(value);
                    });
                text.inputEl.addClass('todo-modal-text-input');
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .setName('Priority')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('none', '⚪ None')
                    .addOption('low', '🟢 Low')
                    .addOption('medium', '🟡 Medium')
                    .addOption('high', '🔴 High')
                    .setValue(this.formData.priority || 'none')
                    .onChange(value => this.formData.priority = value);
            });

        new Setting(contentEl)
            .setName('Due date')
            .setDesc('When is this task due?')
            .addText(text => {
                text.inputEl.type = 'date';
                if (this.formData.dueDate) {
                    const d = new Date(this.formData.dueDate);
                    text.setValue(formatDateForCalendar(d));
                }
                text.onChange(value => {
                    if (value) {
                        const date = new Date(value + 'T00:00:00');
                        this.formData.dueDate = date.toISOString();
                    } else {
                        this.formData.dueDate = null;
                    }
                });
            });

        // All day toggle
        const timeSection = contentEl.createDiv({ cls: 'todo-time-section' });
        
        new Setting(contentEl)
            .setName('All day')
            .setDesc('Toggle off to set specific start/end times')
            .addToggle(toggle => {
                toggle.setValue(this.formData.allDay !== false)
                    .onChange(value => {
                        this.formData.allDay = value;
                        // Show/hide time inputs
                        timeSection.style.display = value ? 'none' : 'block';
                        if (value) {
                            this.formData.startTime = null;
                            this.formData.endTime = null;
                        }
                    });
            });

        // Time section (hidden when allDay is true)
        timeSection.style.display = this.formData.allDay !== false ? 'none' : 'block';

        new Setting(timeSection)
            .setName('Start time')
            .addText(text => {
                text.inputEl.type = 'time';
                text.setValue(this.formData.startTime || '');
                text.onChange(value => {
                    this.formData.startTime = value || null;
                    // Auto-set end time to 1 hour later if not set
                    if (value && !this.formData.endTime) {
                        const [hours, mins] = value.split(':').map(Number);
                        const endHours = (hours + 1) % 24;
                        this.formData.endTime = formatTimeForCalendar(endHours, mins);
                        // Update end time input
                        const endInput = timeSection.querySelector('input[type="time"]:last-of-type');
                        if (endInput) endInput.value = this.formData.endTime;
                    }
                });
            });

        new Setting(timeSection)
            .setName('End time')
            .addText(text => {
                text.inputEl.type = 'time';
                text.setValue(this.formData.endTime || '');
                text.onChange(value => {
                    this.formData.endTime = value || null;
                });
            });

        // Natural language hint
        const naturalLangHint = contentEl.createDiv({ cls: 'todo-natural-lang-hint' });
        naturalLangHint.innerHTML = `<small>💡 Tip: You can also type dates naturally in the task name like "tomorrow at 3pm"</small>`;

        // Recurrence section container
        const recurrenceSection = contentEl.createDiv({ cls: 'todo-recurrence-section' });

        new Setting(recurrenceSection)
            .setName('Repeat')
            .setDesc('For Full Calendar: Daily/Weekly create recurring events')
            .addDropdown(dropdown => {
                for (const [key, opt] of Object.entries(RECURRENCE_OPTIONS)) {
                    dropdown.addOption(key, opt.label);
                }
                dropdown.setValue(this.formData.recurrence || 'none')
                    .onChange(value => {
                        this.formData.recurrence = value === 'none' ? null : value;
                        // Show/hide end date field
                        recurrenceEndSection.style.display = value !== 'none' ? 'block' : 'none';
                    });
            });

        // Recurrence end date (hidden when no recurrence)
        const recurrenceEndSection = recurrenceSection.createDiv({ cls: 'todo-recurrence-end-section' });
        recurrenceEndSection.style.display = this.formData.recurrence ? 'block' : 'none';

        new Setting(recurrenceEndSection)
            .setName('End repeat')
            .setDesc('When should this task stop recurring? (Leave blank for 1 year)')
            .addText(text => {
                text.inputEl.type = 'date';
                if (this.formData.recurrenceEndDate) {
                    const d = new Date(this.formData.recurrenceEndDate);
                    text.setValue(formatDateForCalendar(d));
                }
                text.onChange(value => {
                    if (value) {
                        const date = new Date(value + 'T00:00:00');
                        this.formData.recurrenceEndDate = date.toISOString();
                    } else {
                        this.formData.recurrenceEndDate = null;
                    }
                });
            });

        // Linked Note picker
        const linkedNoteSetting = new Setting(contentEl)
            .setName('Link to note')
            .setDesc('Associate this task with a note in your vault');
        
        const linkedNoteDisplay = linkedNoteSetting.controlEl.createDiv({ cls: 'todo-linked-note-display' });
        
        const updateLinkedNoteDisplay = () => {
            linkedNoteDisplay.empty();
            if (this.formData.linkedNote) {
                const noteChip = linkedNoteDisplay.createDiv({ cls: 'todo-linked-note-chip' });
                const displayName = this.formData.linkedNote.replace(/\.md$/, '').split('/').pop();
                noteChip.createSpan({ text: '📄 ' + displayName, attr: { title: this.formData.linkedNote } });
                const removeBtn = noteChip.createSpan({ cls: 'todo-linked-note-remove', text: '×' });
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.formData.linkedNote = null;
                    updateLinkedNoteDisplay();
                });
            }
        };
        
        linkedNoteSetting.addButton(button => {
            button.setButtonText(this.formData.linkedNote ? 'Change' : 'Select note')
                .onClick(() => {
                    const modal = new NoteSuggestModal(this.app, (file) => {
                        this.formData.linkedNote = file.path;
                        updateLinkedNoteDisplay();
                        button.setButtonText('Change');
                    });
                    modal.open();
                });
        });
        
        updateLinkedNoteDisplay();

        new Setting(contentEl)
            .setName('Notes')
            .setDesc('Supports markdown');
        
        const notesTextarea = contentEl.createEl('textarea', {
            cls: 'todo-modal-notes',
            attr: { placeholder: 'Add details, links, or any additional info...' }
        });
        notesTextarea.value = this.formData.notes || '';
        notesTextarea.addEventListener('input', (e) => {
            this.formData.notes = e.target.value;
        });

        const subtasksSection = contentEl.createDiv({ cls: 'todo-modal-subtasks' });
        subtasksSection.createEl('h4', { text: 'Subtasks' });
        
        const subtasksList = subtasksSection.createDiv({ cls: 'todo-modal-subtasks-list' });
        this.renderSubtasks(subtasksList);
        
        const addSubtaskWrapper = subtasksSection.createDiv({ cls: 'todo-modal-add-subtask' });
        const addSubtaskInput = addSubtaskWrapper.createEl('input', {
            type: 'text',
            placeholder: 'Add subtask...',
            cls: 'todo-modal-subtask-input'
        });
        addSubtaskInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && addSubtaskInput.value.trim()) {
                this.formData.subtasks.push({
                    id: generateId(),
                    text: addSubtaskInput.value.trim(),
                    completed: false,
                    createdAt: Date.now()
                });
                addSubtaskInput.value = '';
                this.renderSubtasks(subtasksList);
            }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'todo-modal-buttons' });
        
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
        
        const saveBtn = buttonContainer.createEl('button', { 
            text: this.task ? 'Save' : 'Add Task',
            cls: 'mod-cta'
        });
        saveBtn.addEventListener('click', () => {
            if (this.formData.text.trim()) {
                this.onSubmit(this.formData);
                this.close();
            } else {
                new Notice('Please enter a task');
            }
        });
    }

    renderSubtasks(container) {
        container.empty();
        this.formData.subtasks.forEach((subtask, index) => {
            const item = container.createDiv({ cls: 'todo-modal-subtask-item' });
            
            const checkbox = item.createEl('input', { 
                type: 'checkbox',
                attr: { checked: subtask.completed }
            });
            checkbox.addEventListener('change', () => {
                subtask.completed = checkbox.checked;
            });
            
            item.createSpan({ text: subtask.text, cls: subtask.completed ? 'completed' : '' });
            
            const deleteBtn = item.createEl('button', { cls: 'todo-modal-subtask-delete' });
            deleteBtn.innerHTML = '×';
            deleteBtn.addEventListener('click', () => {
                this.formData.subtasks.splice(index, 1);
                this.renderSubtasks(container);
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// List Modal
class ListModal extends Modal {
    constructor(app, currentName, currentColor, onSubmit) {
        super(app);
        this.currentName = currentName;
        this.currentColor = currentColor;
        this.selectedColor = currentColor;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('todo-list-modal');

        contentEl.createEl('h3', { text: this.currentName ? 'Edit Project' : 'New Project' });

        const input = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Project name...',
            value: this.currentName || '',
            cls: 'todo-list-modal-input'
        });

        // Color picker section
        const colorSection = contentEl.createDiv({ cls: 'todo-list-modal-colors' });
        colorSection.createEl('label', { text: 'Color (for calendar)' });

        const colorGrid = colorSection.createDiv({ cls: 'todo-color-grid' });

        PROJECT_COLORS.forEach(colorOption => {
            const colorBtn = colorGrid.createDiv({
                cls: `todo-color-option ${this.selectedColor === colorOption.value ? 'selected' : ''}`,
                attr: { title: colorOption.name }
            });

            if (colorOption.value) {
                colorBtn.style.backgroundColor = colorOption.value;
            } else {
                colorBtn.addClass('default');
                colorBtn.innerHTML = '—';
            }

            colorBtn.addEventListener('click', () => {
                colorGrid.querySelectorAll('.todo-color-option').forEach(btn => btn.removeClass('selected'));
                colorBtn.addClass('selected');
                this.selectedColor = colorOption.value;
            });
        });

        const submitIfValid = () => {
            const name = input.value.trim();
            if (name) {
                this.onSubmit(name, this.selectedColor);
                this.close();
            } else {
                new Notice('Project name cannot be empty');
                input.focus();
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                submitIfValid();
            }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'todo-modal-buttons' });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = buttonContainer.createEl('button', {
            text: this.currentName ? 'Save' : 'Create',
            cls: 'mod-cta'
        });
        saveBtn.addEventListener('click', submitIfValid);

        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Settings Modal
class TodoSettingsModal extends Modal {
    constructor(app, settings, onSubmit) {
        super(app);
        this.settings = { ...settings };
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('todo-settings-modal');
        
        contentEl.createEl('h2', { text: 'Todo Checklist Settings' });
        
        // Full Calendar Sync Section
        contentEl.createEl('h3', { text: 'Full Calendar Integration' });
        
        new Setting(contentEl)
            .setName('Enable calendar sync')
            .setDesc('Automatically create calendar events for tasks with due dates')
            .addToggle(toggle => {
                toggle.setValue(this.settings.fullCalendarSync)
                    .onChange(value => this.settings.fullCalendarSync = value);
            });
        
        new Setting(contentEl)
            .setName('Calendar folder')
            .setDesc('Folder where task events will be created (must match Full Calendar source)')
            .addText(text => {
                text.setPlaceholder('calendar/tasks')
                    .setValue(this.settings.fullCalendarFolder)
                    .onChange(value => this.settings.fullCalendarFolder = value || 'calendar/tasks');
            });

        new Setting(contentEl)
            .setName('Re-sync all tasks')
            .setDesc('Recreate all calendar files in project subfolders')
            .addButton(button => {
                button.setButtonText('Sync All')
                    .onClick(async () => {
                        this.onSubmit(this.settings, true); // true = trigger resync
                        this.close();
                    });
            });

        // Notifications Section
        contentEl.createEl('h3', { text: 'Notifications' });
        
        new Setting(contentEl)
            .setName('Due date notifications')
            .setDesc('Show notifications for tasks due today and 15 min before timed tasks')
            .addToggle(toggle => {
                toggle.setValue(this.settings.notifications)
                    .onChange(value => this.settings.notifications = value);
            });

        // Behavior Section
        contentEl.createEl('h3', { text: 'Behavior' });

        new Setting(contentEl)
            .setName('Confirmation dialogs')
            .setDesc('Show confirmation dialogs before deleting tasks (disable for faster workflow)')
            .addToggle(toggle => {
                toggle.setValue(this.settings.enableConfirmDialogs)
                    .onChange(value => this.settings.enableConfirmDialogs = value);
            });

        new Setting(contentEl)
            .setName('Animations')
            .setDesc('Enable task completion and slide-in animations')
            .addToggle(toggle => {
                toggle.setValue(this.settings.enableAnimations)
                    .onChange(value => this.settings.enableAnimations = value);
            });

        new Setting(contentEl)
            .setName('Keyboard navigation')
            .setDesc('Enable vim-style keyboard shortcuts (j/k, x, e, d, m, p, etc.)')
            .addToggle(toggle => {
                toggle.setValue(this.settings.enableKeyboardNavigation)
                    .onChange(value => this.settings.enableKeyboardNavigation = value);
            });

        new Setting(contentEl)
            .setName('Quick capture')
            .setDesc('Enable global quick capture command (Ctrl+Shift+A)')
            .addToggle(toggle => {
                toggle.setValue(this.settings.enableQuickCapture)
                    .onChange(value => this.settings.enableQuickCapture = value);
            });

        // Keyboard shortcuts reference
        contentEl.createEl('h3', { text: 'Keyboard Shortcuts' });
        
        const shortcutsEl = contentEl.createDiv({ cls: 'todo-settings-shortcuts' });
        shortcutsEl.innerHTML = `
            <div class="todo-shortcut"><kbd>j</kbd> / <kbd>k</kbd> Navigate up/down</div>
            <div class="todo-shortcut"><kbd>x</kbd> / <kbd>Space</kbd> Complete task</div>
            <div class="todo-shortcut"><kbd>e</kbd> / <kbd>Enter</kbd> Edit task</div>
            <div class="todo-shortcut"><kbd>d</kbd> / <kbd>Delete</kbd> Delete task</div>
            <div class="todo-shortcut"><kbd>m</kbd> Move to list</div>
            <div class="todo-shortcut"><kbd>p</kbd> Cycle priority</div>
            <div class="todo-shortcut"><kbd>n</kbd> Focus new task input</div>
            <div class="todo-shortcut"><kbd>/</kbd> Focus search</div>
            <div class="todo-shortcut"><kbd>Ctrl+Z</kbd> Undo</div>
            <div class="todo-shortcut"><kbd>gg</kbd> Go to top</div>
            <div class="todo-shortcut"><kbd>G</kbd> Go to bottom</div>
            <div class="todo-shortcut"><kbd>Esc</kbd> Exit keyboard nav</div>
        `;
        
        // Info section
        const infoEl = contentEl.createDiv({ cls: 'todo-settings-info' });
        infoEl.innerHTML = `
            <p><strong>Full Calendar Setup:</strong></p>
            <ol>
                <li>Install "Full Calendar" plugin from Community Plugins</li>
                <li>Enable calendar sync above</li>
                <li>Right-click projects → Edit → assign colors</li>
                <li>Click "Sync All" to sync tasks and register calendars</li>
            </ol>
            <p><strong>Project Colors:</strong> Each project with a color is automatically
            registered as a separate calendar in Full Calendar with matching colors.
            <em>Reload Obsidian after syncing to see color changes in the calendar.</em></p>
        `;
        
        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'todo-modal-buttons' });
        
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
        
        const saveBtn = buttonContainer.createEl('button', { 
            text: 'Save Settings',
            cls: 'mod-cta'
        });
        saveBtn.addEventListener('click', () => {
            this.onSubmit(this.settings);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Global Quick Capture Modal
class QuickCaptureModal extends Modal {
    constructor(app, plugin, onSubmit) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('todo-quick-capture-modal');
        
        const input = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Quick add task... (try: "Call mom tomorrow at 3pm #personal")',
            cls: 'todo-quick-capture-input'
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                this.onSubmit(input.value.trim());
                this.close();
            }
            if (e.key === 'Escape') {
                this.close();
            }
        });
        
        setTimeout(() => input.focus(), 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Plugin Settings Tab (appears in Obsidian Settings)
class TodoSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Todo Checklist Pro Settings' });

        // Get current settings from the view if it exists, otherwise use defaults
        let settings = { ...DEFAULT_SETTINGS };

        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
        if (leaf && leaf.view && leaf.view.data && leaf.view.data.settings) {
            settings = leaf.view.data.settings;
        } else {
            // Try to load from plugin data
            const saved = await this.plugin.loadData();
            if (saved && saved.settings) {
                settings = { ...settings, ...saved.settings };
            }
        }

        // Full Calendar Integration
        containerEl.createEl('h3', { text: 'Full Calendar Integration' });

        new Setting(containerEl)
            .setName('Enable calendar sync')
            .setDesc('Automatically create calendar events for tasks with due dates')
            .addToggle(toggle => {
                toggle.setValue(settings.fullCalendarSync)
                    .onChange(async (value) => {
                        await this.updateSetting('fullCalendarSync', value);
                    });
            });

        new Setting(containerEl)
            .setName('Calendar folder')
            .setDesc('Folder where task events will be created (must match Full Calendar source)')
            .addText(text => {
                text.setPlaceholder('calendar/tasks')
                    .setValue(settings.fullCalendarFolder)
                    .onChange(async (value) => {
                        await this.updateSetting('fullCalendarFolder', value || 'calendar/tasks');
                    });
            });

        // Notifications
        containerEl.createEl('h3', { text: 'Notifications' });

        new Setting(containerEl)
            .setName('Due date notifications')
            .setDesc('Show notifications for tasks due today and 15 min before timed tasks')
            .addToggle(toggle => {
                toggle.setValue(settings.notifications)
                    .onChange(async (value) => {
                        await this.updateSetting('notifications', value);
                    });
            });

        // Behavior section
        containerEl.createEl('h3', { text: 'Behavior' });

        new Setting(containerEl)
            .setName('Confirmation dialogs')
            .setDesc('Show confirmation dialogs before deleting tasks (disable for faster workflow)')
            .addToggle(toggle => {
                toggle.setValue(settings.enableConfirmDialogs)
                    .onChange(async (value) => {
                        await this.updateSetting('enableConfirmDialogs', value);
                    });
            });

        new Setting(containerEl)
            .setName('Animations')
            .setDesc('Enable task completion and slide-in animations')
            .addToggle(toggle => {
                toggle.setValue(settings.enableAnimations)
                    .onChange(async (value) => {
                        await this.updateSetting('enableAnimations', value);
                    });
            });

        new Setting(containerEl)
            .setName('Keyboard navigation')
            .setDesc('Enable vim-style keyboard shortcuts (j/k, x, e, d, m, p, etc.)')
            .addToggle(toggle => {
                toggle.setValue(settings.enableKeyboardNavigation)
                    .onChange(async (value) => {
                        await this.updateSetting('enableKeyboardNavigation', value);
                    });
            });

        new Setting(containerEl)
            .setName('Quick capture')
            .setDesc('Enable global quick capture command (Ctrl+Shift+A)')
            .addToggle(toggle => {
                toggle.setValue(settings.enableQuickCapture)
                    .onChange(async (value) => {
                        await this.updateSetting('enableQuickCapture', value);
                    });
            });

        // Info section
        containerEl.createEl('h3', { text: 'Full Calendar Setup' });

        const infoEl = containerEl.createDiv({ cls: 'setting-item-description' });
        infoEl.innerHTML = `
            <ol>
                <li>Install "Full Calendar" plugin from Community Plugins</li>
                <li>Enable calendar sync above and set a folder (e.g., <code>calendar/tasks</code>)</li>
                <li>In Full Calendar settings, click "Manage Calendars"</li>
                <li>Add a new calendar with type "Local" and set the folder to match above</li>
                <li>Tasks with due dates will now appear on your calendar!</li>
            </ol>
        `;
    }

    async updateSetting(key, value) {
        try {
            // Update in the view if it's open
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
            if (leaf && leaf.view && leaf.view.data && leaf.view.data.settings) {
                leaf.view.data.settings[key] = value;
                await leaf.view.saveData();
                leaf.view.render();
            } else {
                // Update in plugin data directly
                let data = await this.plugin.loadData() || {};
                if (!data.settings) {
                    data.settings = { ...DEFAULT_SETTINGS };
                }
                data.settings[key] = value;
                await this.plugin.saveData(data);
            }
        } catch (error) {
            console.error(`Failed to update setting ${key}:`, error);
            new Notice(`Failed to save setting. Please try again.`);
        }
    }
}

// Main Plugin
class TodoChecklistPlugin extends Plugin {
    async onload() {
        this.registerView(
            VIEW_TYPE_TODO,
            (leaf) => new TodoChecklistView(leaf, this)
        );

        // Add settings tab to Obsidian settings
        this.addSettingTab(new TodoSettingTab(this.app, this));

        this.addRibbonIcon('check-square', 'Open Todo Checklist', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-todo-checklist',
            name: 'Open Todo Checklist',
            callback: () => this.activateView()
        });

        this.addCommand({
            id: 'quick-add-todo',
            name: 'Quick add todo',
            callback: () => this.quickAddTodo()
        });

        // Global quick capture hotkey
        this.addCommand({
            id: 'global-quick-capture',
            name: 'Quick capture task (global)',
            hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'a' }],
            callback: () => this.globalQuickCapture()
        });

        // Listen for file renames to update linked notes
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                // Guard against null/undefined file or path
                if (file && file.path && oldPath) {
                    this.handleFileRename(file.path, oldPath);
                }
            })
        );

        // Listen for file deletions to clear broken links
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                // Guard against null/undefined file
                if (file && file.path) {
                    this.handleFileDelete(file.path);
                }
            })
        );
    }

    // Update linked note paths when files are renamed
    async handleFileRename(newPath, oldPath) {
        // Try to use open view first, otherwise load data directly
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
        let data = leaf?.view?.data;
        let useView = !!data;

        if (!data) {
            // View not open, load data directly from plugin storage
            data = await this.loadData();
            if (!data?.lists) return;
        }

        let changed = false;
        for (const listId in data.lists) {
            const list = data.lists[listId];
            const allTasks = [...(list.todos || []), ...(list.archived || [])];
            for (const task of allTasks) {
                if (task.linkedNote === oldPath) {
                    task.linkedNote = newPath;
                    changed = true;
                }
            }
        }

        if (changed) {
            if (useView) {
                await leaf.view.saveData();
                leaf.view.render();
            } else {
                await this.saveData(data);
            }
        }
    }

    // Clear linked note references when files are deleted
    async handleFileDelete(deletedPath) {
        // Try to use open view first, otherwise load data directly
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
        let data = leaf?.view?.data;
        let useView = !!data;

        if (!data) {
            // View not open, load data directly from plugin storage
            data = await this.loadData();
            if (!data?.lists) return;
        }

        let changed = false;
        for (const listId in data.lists) {
            const list = data.lists[listId];
            const allTasks = [...(list.todos || []), ...(list.archived || [])];
            for (const task of allTasks) {
                if (task.linkedNote === deletedPath) {
                    task.linkedNote = null;
                    changed = true;
                }
            }
        }

        if (changed) {
            if (useView) {
                await leaf.view.saveData();
                leaf.view.render();
            } else {
                await this.saveData(data);
            }
        }
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TODO);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
        
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({
                type: VIEW_TYPE_TODO,
                active: true,
            });
        }
        workspace.revealLeaf(leaf);
    }

    async quickAddTodo() {
        const modal = new TaskEditModal(this.app, this, null, '', async (task) => {
            if (task) {
                let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
                if (!leaf) {
                    await this.activateView();
                    leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
                }
                if (leaf && leaf.view instanceof TodoChecklistView) {
                    const currentListId = leaf.view.data.currentList;
                    leaf.view.getCurrentList().todos.unshift(task);

                    if (leaf.view.data.settings.fullCalendarSync && task.dueDate) {
                        await leaf.view.syncTaskToCalendar(task);
                    }

                    // Push to undo stack
                    leaf.view.pushUndo('add', { task: leaf.view.cloneTask(task), listId: currentListId });

                    await leaf.view.saveData();
                    leaf.view.render();
                    new Notice('Task added (Ctrl+Z to undo)');
                }
            }
        });
        modal.open();
    }

    async globalQuickCapture() {
        // Check if quick capture is enabled
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
        let enabled = true;
        if (leaf && leaf.view && leaf.view.data && leaf.view.data.settings) {
            enabled = leaf.view.data.settings.enableQuickCapture !== false;
        } else {
            const saved = await this.loadData();
            if (saved && saved.settings && saved.settings.enableQuickCapture === false) {
                enabled = false;
            }
        }
        if (!enabled) {
            new Notice('Quick capture is disabled. Enable it in settings.');
            return;
        }

        const modal = new QuickCaptureModal(this.app, this, async (text) => {
            let taskLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
            if (!taskLeaf) {
                await this.activateView();
                taskLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)[0];
            }
            if (taskLeaf && taskLeaf.view instanceof TodoChecklistView) {
                taskLeaf.view.quickAddTodo(text);
            }
        });
        modal.open();
    }
}

module.exports = TodoChecklistPlugin;