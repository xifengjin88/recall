# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Project permissions for routine read-only and test commands are in `.claude/settings.json`; add new routine commands there rather than asking each time.
- Planning and build workflow uses the agent-skills plugin: `/agent-skills:spec` for module specs, `/agent-skills:plan` for `tasks/`, `/agent-skills:build` to work through `tasks/todo.md` one task at a time.
- When a task finishes, tick it in `tasks/todo.md` and summarise what was verified (commands run and their result), not just what was changed.
