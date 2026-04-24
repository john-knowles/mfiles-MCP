# mfiles-MCP

> [!CAUTION]
> **Experimental:** This is an experimental Model Context Protocol (MCP) server that explores what might be possible for M-Files integration. It is provided "as is" for demonstration and discovery purposes.

An MCP server for the **M-Files Web Service (MFWS) REST API**.


## What you get

- **Core request helper**: `src/mfiles/MFilesRequest.ts`
  - Handles `X-Authentication`
  - Supports username/password login via `/server/authenticationtokens.aspx`
  - Optional vault selection via `MFILES_VAULT_GUID` using `/session/vaults.aspx`
  - Supports MFWS IIS compatibility method tunneling for `PUT`/`DELETE` via `?_method=`
- **High-value tools first**
  - `/objects`: search, create, delete
  - `/views`: list views and fetch view listing
  - `/structure`: propertydefs, classdefs, objecttypes
  - `/files`: `download_file` (text extraction where possible) + `upload_file` (spec-correct temp upload flow)
- **Generic escape hatch**: `generic_mfiles_request` for any endpoint not yet covered.
- **Schema discovery**: `discover_schema` loads `/structure/properties` and `/structure/objecttypes`.

## Available Tools

- **`discover_schema`**: Fetch vault structure metadata to resolve property and object type IDs.
- **`generic_mfiles_request`**: Execute any MFWS REST endpoint with support for method tunneling.
- **`objects_search`**: Search objects with support for Quick Search (`q`) and human-readable property filters (e.g. `{ "Customer": "Acme" }`).
- **`objects_get`**: Fetch a specific object version.
- **`objects_create`**: Create new objects (e.g. Documents).
- **`objects_delete`**: Delete objects from the vault.
- **`views_list`**: List available vault views.
- **`views_get_listing`**: Fetch items within a specific view.
- **`structure_propertydefs`**: List all property definitions.
- **`structure_classdefs`**: List all class definitions.
- **`structure_objecttypes`**: List all object types.
- **`download_file`**: Download files with automatic text extraction for `.txt`, `.md`, and `.pdf` files.
- **`upload_file`**: Upload files to existing objects (handles checkout, temporary upload, and checkin).

## Setup

Install deps:

```bash
npm install
```

Configure environment:

- **`MFILES_BASE_URL`**: base REST URL, e.g. `https://your-host/REST`
- Choose one auth mode:
  - **Token**: `MFILES_AUTH_TOKEN`
  - **Username/password**: `MFILES_USERNAME`, `MFILES_PASSWORD`
- Optional:
  - **`MFILES_VAULT_GUID`**: if set (and using username/password), the server will acquire a vault-level token.

## Run

This server loads environment variables from `.env` automatically (via `dotenv`).

```bash
npm run dev
```

or build + run:

```bash
npm run build
npm start
```

## Notes

- MFWS commonly uses `.aspx` endpoints. The tools accept any path, but you’ll usually want `.aspx`.
- If a specific tool is missing or your MFWS payload differs, use **`generic_mfiles_request`**.