# xhs-app

Portable Windows package for the XHS operations tool.

## Requirement

- Preferred: keep the bundled runtime in `tools\nodejs` for zero-setup startup
- Fallback: if you remove `tools\nodejs`, install Node.js 20 or newer and ensure it is available in `PATH`

## One-click startup

Double-click:

```text
start-company.cmd
```

Or run:

```powershell
.\start-company.ps1
```

The script will automatically:

- install npm dependencies
- build the frontend
- build the bundled `jimeng-api` service
- start both services
- open the frontend in the browser

## Stop services

Double-click:

```text
stop-company.cmd
```

Or run:

```powershell
.\stop-company.ps1
```

## Clear browser local data

Double-click:

```text
clear-local-data.cmd
```

Or run:

```powershell
.\clear-local-data.ps1
```

This opens a local cleanup page that removes the current browser's cached data for
`http://127.0.0.1:3000`, including localStorage and IndexedDB.

## Important paths

- frontend root: current folder
- local service: `services\jimeng-api`
- env file: `.env.local`
- env template: `.env.example`
- bundled Node.js runtime: `tools\nodejs`
- runtime logs and pid files: `.runtime\`

## Common env changes

- Feishu document library link: `NEXT_PUBLIC_FEISHU_DOC_LIBRARY_URL`

## Portability

This folder can be copied to any location on a company computer.
The startup scripts only use paths relative to the script location.
