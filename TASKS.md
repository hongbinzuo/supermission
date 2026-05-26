# Short Task Handles

This file is the repo-root task index for human and agent prompts that use short
handles.

When the user says `continue 3`, resolve `3` through this file first, then read
the matching `.supermission/<id>` work record. If the directory exists but this
index is stale, `.supermission/<id>` remains the source of truth.

| Handle | Work record       | Status    | Summary                                                                     |
| ------ | ----------------- | --------- | --------------------------------------------------------------------------- |
| `1`    | `.supermission/1` | completed | test1                                                                       |
| `2`    | `.supermission/2` | draft     | Add a small feature: task name can be changed.                              |
| `3`    | `.supermission/3` | completed | Add a feature so `superm` can auto-produce a standard tmux terminal layout. |
| `4`    | `.supermission/4` | draft     | add colorful them for command prompt                                        |
| `5`    | `.supermission/5` | draft     | add more tests for recent features                                          |
| `6`    | `.supermission/6` | completed | close 1                                                                     |
