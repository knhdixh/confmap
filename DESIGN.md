# confmap design sheet

confmap looks and handles like **Todoist**. This sheet holds the rules; keep new UI inside them.
(It deliberately does not use the knhdixh house style.)

## Look

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#dc4c3e` | `#de4c4a` | primary buttons, "Add" plus, active nav text, focus |
| `--bg` | `#ffffff` | `#1e1e1e` | content |
| `--sidebar` | `#fcfaf8` | `#262626` | left sidebar |
| `--nav-active` | `#ffefe5` | `#3b2a25` | selected sidebar item |
| `--hover` | `#f2efed` | `#333` | hovered rows and items |
| `--text` | `#202020` | `#e8e8e8` | body |
| `--muted` | `#666` | `#9a9a9a` | meta lines |
| `--line` | `#f0f0f0` | `#333` | 1px row separators |
| p1 / p2 / p3 / p4 | `#d1453b` / `#eb8909` / `#246fe0` / `#999` | same | priority circles and flags |
| due today / tomorrow / this week / overdue | `#058527` / `#ad6200` / `#692ec2` / `#d1453b` | | date labels |

- System font stack, 14px body, 13px meta lines, 12px badges. Page titles 20px bold. No gradients, soft shadows only on floating layers (menus, dialogs).
- Rows: no cards. A row is a circle (or avatar) on the left, a title line, a muted meta line, actions that appear on hover on the right, and a 1px line underneath.
- Priority is a coloured ring around the circle (p1 red … p4 grey) with a faint fill of the same colour, like Todoist checkboxes.
- Under every list, an inline "+ Add …" row (grey plus, turns red on hover) opens an inline editor in place.
- Sections inside a list have a bold 14px header with a count and a hairline under it.
- Dialogs (quick add, search) float at ~15% from the top, 550–650px wide, with 10px radius.
- Toasts sit bottom-left, dark, with an optional **Undo**.
- Dates use Todoist wording and colours: Today, Tomorrow, weekday names within a week, "12 Dec" after that.

## Controls

| Key | Action |
|---|---|
| `q` | Quick add (task; paste a link and it becomes "add researcher") |
| `p` | Add researcher |
| `/` or `⌘K` | Search and commands |
| `m` | Toggle sidebar |
| `g` then `r` `v` `u` `g` `i` `s` | Go to Researchers, Venues, Upcoming, Graph, Insights, Settings |
| `j` / `k` or ↓ / ↑ | Move the selection |
| `Enter` | Open the selected row |
| `e` | Complete the selected task |
| `1` – `4` | Set priority of the selected venue or task |
| `Esc` | Close dialog, or go back from a detail page |
| `?` | Show shortcuts |

Quick add understands Todoist syntax: dates (`today`, `tomorrow`, `fri`, `next week`, `in 2 weeks`, `dec 5`, `2027-01-20`), `p1`–`p4` and `#Venue` (e.g. `#NeurIPS`, `#"CVPR"`).
