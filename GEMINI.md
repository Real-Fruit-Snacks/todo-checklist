# Project Overview

This is a feature-rich "Todo Checklist Pro" plugin for the Obsidian note-taking application. It provides a powerful task management system that lives in the Obsidian sidebar. The plugin is written in vanilla JavaScript and uses the Obsidian API for its UI and functionality.

**Key Features:**

*   **Task Management:** Create, edit, delete, and complete tasks.
*   **Organization:** Multiple lists/projects, priorities, due dates, recurring tasks, subtasks, and tags.
*   **Navigation:** Vim-style keyboard navigation and drag-and-drop reordering.
*   **Integration:** Syncs with the "Full Calendar" plugin.
*   **Data Persistence:** Tasks are stored in a `data.json` file within the plugin's folder.

# Building and Running

This is an Obsidian plugin and is not intended to be run as a standalone application. To use the plugin, follow these steps:

1.  Navigate to your Obsidian vault's plugins folder:
    ```
    <your-vault>/.obsidian/plugins/
    ```
2.  Create a new folder called `todo-checklist`.
3.  Copy these files into the folder:
    *   `main.js`
    *   `manifest.json`
    *   `styles.css`
4.  Restart Obsidian.
5.  Go to **Settings → Community plugins**.
6.  Find "Todo Checklist Pro" and enable it.

There are no explicit build commands. The plugin is distributed as a set of JavaScript and CSS files.

# Development Conventions

*   **Core Logic:** The entire plugin's logic is contained within the `main.js` file.
*   **Styling:** All styles are in the `styles.css` file. The stylesheet is well-structured and uses CSS variables for theming, making it compatible with Obsidian's light and dark themes.
*   **Dependencies:** The plugin uses the `obsidian` API, which is available in the Obsidian environment. There are no other external dependencies.
*   **Modularity:** The code in `main.js` is organized into classes for different UI components (views, modals) and a main plugin class that ties everything together.
*   **Data:** The plugin's data is stored in a `data.json` file in the plugin's directory. The data structure is well-defined in the `README.md`.
