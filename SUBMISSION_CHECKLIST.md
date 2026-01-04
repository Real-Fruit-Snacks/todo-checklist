# Obsidian Community Plugin Submission Checklist

## Pre-Submission Requirements

### Repository Setup
- [ ] Repository is **public** on GitHub
- [ ] Repository URL: `https://github.com/Real-Fruit-Snacks/todo-checklist`
- [ ] Repository name matches manifest.json `id`: `todo-checklist`
- [ ] Add repository topics: `obsidian-plugin`, `obsidian-md`, `task-manager`

### Required Files (All Present)
- [x] `manifest.json` - Plugin descriptor
- [x] `main.js` - Plugin code
- [x] `styles.css` - Plugin styles
- [x] `README.md` - Documentation
- [x] `LICENSE` - MIT License

### Recommended Files (All Present)
- [x] `versions.json` - Version compatibility mapping
- [x] `.github/workflows/release.yml` - Automated releases
- [x] `.gitignore` - Git ignore rules

---

## Create GitHub Release

### Step 1: Commit All Files
```bash
git add .
git commit -m "Prepare for Obsidian Community Plugin submission"
git push origin main
```

### Step 2: Create Version Tag
```bash
git tag 2.5.1
git push origin 2.5.1
```

**IMPORTANT:** The tag MUST:
- Be exactly `2.5.1` (NO "v" prefix)
- Match `manifest.json` version exactly
- NOT be a draft or pre-release

### Step 3: Verify Release
The GitHub Action will automatically create a release with the required files attached:
- `main.js`
- `manifest.json`
- `styles.css`

If the Action doesn't run, manually create a release:
1. Go to GitHub → Releases → "Create a new release"
2. Select tag `2.5.1`
3. Title: `2.5.1`
4. Upload: `main.js`, `manifest.json`, `styles.css`
5. **Uncheck** "This is a pre-release"
6. Click "Publish release"

---

## Submit to Obsidian Community Plugins

### Step 1: Fork obsidian-releases
1. Go to https://github.com/obsidianmd/obsidian-releases
2. Click "Fork" to create your copy

### Step 2: Edit community-plugins.json
1. Open `community-plugins.json` in your fork
2. Add this entry at the **END** of the array (before the closing `]`):

```json
{
    "id": "todo-checklist",
    "name": "Todo Checklist Pro",
    "author": "Real-Fruit-Snacks",
    "description": "A powerful sidebar todo manager with keyboard navigation, undo, priorities, due dates/times, recurring tasks, subtasks, multiple projects, smart lists, tags, search, and Full Calendar integration.",
    "repo": "Real-Fruit-Snacks/todo-checklist"
}
```

**CRITICAL:** All fields must match `manifest.json` EXACTLY (case-sensitive).

### Step 3: Create Pull Request
1. Commit your changes
2. Create a Pull Request to `obsidianmd/obsidian-releases`
3. In the PR description, switch to Preview mode
4. Select the submission checklist option and confirm all items

### Step 4: Wait for Review
- An automated bot will validate your submission
- Maintainers will review the plugin
- Address any feedback promptly
- Once approved and merged, your plugin appears in Community Plugins!

---

## Common Rejection Reasons

### Field Mismatches
The bot checks that these fields match EXACTLY:
- `id` in JSON = `id` in manifest.json
- `name` in JSON = `name` in manifest.json
- `author` in JSON = `author` in manifest.json
- `description` in JSON = `description` in manifest.json

### Release Issues
- Tag has wrong format (e.g., `v2.5.1` instead of `2.5.1`)
- Release is marked as draft or pre-release
- Release doesn't have all 3 required files attached
- manifest.json version doesn't match tag

### Plugin ID Issues
- ID contains "obsidian" or "plugin"
- ID already exists in the registry
- ID doesn't match repository name

---

## Verification Checklist

Before submitting, verify:

- [ ] GitHub repository is public
- [ ] Release tag `2.5.1` exists and is published (not draft/pre-release)
- [ ] Release has `main.js`, `manifest.json`, `styles.css` attached
- [ ] manifest.json has correct author: `Real-Fruit-Snacks`
- [ ] manifest.json has correct authorUrl: `https://github.com/Real-Fruit-Snacks`
- [ ] All community-plugins.json fields match manifest.json exactly
- [ ] Entry is at the END of community-plugins.json array

---

## After Submission

### Timeline
- Bot validation: Immediate (within minutes)
- Human review: Days to weeks (depending on queue)
- Availability: Immediate after merge

### Updates
For future updates:
1. Update `version` in manifest.json
2. Add entry to versions.json
3. Create new git tag matching the version
4. Push tag to trigger release workflow
5. Plugin updates automatically for users

---

## Resources

- [Obsidian Plugin Submission Docs](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [obsidian-releases Repository](https://github.com/obsidianmd/obsidian-releases)
