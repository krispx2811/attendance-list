# Attendance List

A daily attendance tracker for Windows. Record who came, who didn't, and why —
then export it to Excel.

![Attendance List](assets/icon.png)

## Download

Get the latest build from the
[Releases page](https://github.com/krispx2811/attendance-list/releases/latest).

| File | Use it when |
|---|---|
| `AttendanceList-Setup-x.y.z.exe` | **Most people.** Installs it properly, adds shortcuts, and updates itself from then on. |
| `AttendanceList.exe` | Portable — one file, no install, keeps its data beside itself. Good for a USB stick. |

> **First launch:** Windows shows *"Windows protected your PC"* because the app
> is not code-signed (a certificate costs several hundred dollars a year).
> Click **More info → Run anyway**. You only do this once.

## Updating

The app checks GitHub for new versions when it starts. When one exists a banner
appears — click **Update**, and when it finishes, **Restart now**. Your data is
untouched.

You can also check any time from **Reports → Check for updates**.

## Using it

### Today
The screen you use each morning.

- Everyone is listed. Click **Present**, **Late** or **Absent**.
- The **reason** box appears only for Late and Absent, and suggests reasons you
  have used before as you type.
- **Mark everyone present** sets the whole list at once — then correct the few
  exceptions. This is the fastest way to do a day.
- The arrows next to the date let you fill in a day you missed.

Everything saves the moment you click. There is no Save button.

**Keyboard** — much faster than clicking once you have more than a few people:

| Key | Does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move between people |
| <kbd>P</kbd> | Present, and move to the next person |
| <kbd>L</kbd> | Late, and jump to the reason box |
| <kbd>A</kbd> | Absent, and jump to the reason box |
| <kbd>⌫</kbd> | Clear that person's status |

### Employees
Add, rename and remove people.

- **Add several** takes a whole pasted list, one name per line.
- **Remove** hides someone from the daily list but keeps all their history —
  use this when somebody leaves.
- **Delete** erases the person *and* their records. It asks first.
- A **guest** is someone recorded for one day who is not a permanent employee.
  **Make employee** promotes them.

### History
Search past records by name, date range or status, then export.

- **Excel** produces a colour-coded `.xlsx` (green present, amber late, red
  absent) with filters already switched on.
- **CSV** for anything else.
- Click any row to see that person's full history and attendance rate.

### Reports
Attendance rate per person, the most common reasons for absence, and:

- **Full report** — one workbook with three sheets: Records, Summary, Reasons.
- **Back up now** and **Save a copy** for keeping a copy elsewhere.

## Where your data is kept

In a `data` folder next to the app:

```
AttendanceList.exe
data\
    attendance.db      all attendance records
    backups\           automatic daily backups (last 14 kept)
```

Updating never touches that folder. Data never leaves the computer — the app
contacts GitHub only to check for a new version.

**To move everything to another computer**, copy the whole folder.

> If the app sits somewhere Windows will not let it write — `C:\Program Files`,
> a locked-down share — it falls back to your user profile automatically rather
> than failing. The installer handles this for you; it only matters for the
> portable version.

**To share one list across several PCs**, set the environment variable
`ATTENDANCE_DATA_DIR` to a shared network folder on each machine. Best with one
person editing at a time — SQLite over a network share does not handle
simultaneous writers well.

---

## Development

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

On a Mac you can also double-click `run-on-mac.command`.

Run the tests:

```bash
npm test
```

They run under Electron's own Node so the native `better-sqlite3` binding is
loaded with the same ABI the app uses — passing under the system Node while
failing when packaged is the worst kind of green build.

Use a throwaway database while developing:

```bash
ATTENDANCE_DATA_DIR=/tmp/attendance-dev npm start
```

> If your editor exports `ELECTRON_RUN_AS_NODE` (VS Code does), `npm start`
> runs the main file as a plain Node script and no window appears. Clear it:
> `env -u ELECTRON_RUN_AS_NODE npm start`.

### Layout

| Path | What it does |
|---|---|
| `src/main/main.js` | App lifecycle and the window |
| `src/main/db.js` | SQLite schema and every query |
| `src/main/exporter.js` | CSV and Excel output |
| `src/main/updater.js` | GitHub release checks via electron-updater |
| `src/main/ipc.js` | The only channels the UI can call |
| `src/main/paths.js` | Where the database and backups live |
| `src/preload/preload.js` | The renderer's entire view of the outside world |
| `src/renderer/` | The interface: `styles.css` is the design system |
| `tests/db.test.js` | Storage and export tests |

The renderer runs with `contextIsolation` on and `nodeIntegration` off. It has
no filesystem or Node access; everything goes through the named channels in
`preload.js`.

### Releasing a new version

The Windows build happens on GitHub Actions — a Windows runner is needed to
produce a Windows binary.

1. Bump `version` in `package.json`.
2. Commit.
3. Tag and push:

```bash
git tag v2.0.1
git push origin main --tags
```

Actions runs the tests, builds the installer and portable exe, smoke-tests the
result by actually launching it, and publishes a Release. Everyone on an older
build is offered the update the next time they open the app.

Use **Actions → Build Windows app → Run workflow** to build without releasing;
the artifacts appear as a downloadable zip.
