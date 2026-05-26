# Agent Operating Notes

Follow the project rules in `AGENTS.md`.

## Task Handle Resolution

Short task prompts are intentional in this repository. If the user says
`continue 3`, `continue x`, `do 6`, `resume 2`, `/task 3`, or any similar short
handle, resolve the handle before answering that you lack context.

Resolution order:

1. Read the repo-root `TASKS.md` task index.
2. Map the handle to the listed work record, usually `.supermission/<id>`.
3. Read `.supermission/<id>/work.yaml`, `.supermission/<id>/plan.md`,
   `.supermission/<id>/monitor.md`, and `.supermission/<id>/tasks/*.yaml`.
4. If `.supermission/<id>` exists but `TASKS.md` is missing or stale, use the
   `.supermission/<id>` record as the source of truth and report that the index
   needs updating.
