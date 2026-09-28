# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Permissions live in `.claude/settings.json` (CLAUDE.md can't grant them). Allowed without asking: reading anything, editing/writing files inside this repo, everyday shell commands (cd, ls, cat, grep, sed, mkdir, cp, mv, python3, node), the project tools (npm, npx, uv, make), local git (status, diff, add, commit, mv, new branches), `docker compose up/stop/ps/logs` and `psql`. Still asks: `rm`, `git push`, `git reset`, `git checkout --`, `docker compose down` (wipes the database volume). Add new routine commands there rather than asking each time.
- **Stay inside this project directory.** Don't read or write outside it (no `/tmp`, no home-directory files). Intermediate and throwaway files go in `.tmp/` at the repo root, which git ignores.
- To keep prompts away: create and change files with the Write/Edit tools, not shell heredocs (`cat > f <<EOF`) or multi-line `python3 -c "…"` scripts, which the permission checker can't parse and asks about. Put throwaway scripts in `.tmp/` and run them from there. Keep shell commands to plain tool invocations chained with `&&`.
- Planning and build workflow uses the agent-skills plugin: `/agent-skills:spec` for module specs, `/agent-skills:plan` for `tasks/`, `/agent-skills:build` to work through `tasks/todo.md` one task at a time.
- When a task finishes, tick it in `tasks/todo.md` and summarise what was verified (commands run and their result), not just what was changed.
