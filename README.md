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

- **`discover_schema`**: Fetch vault structure metadata (properties, object types, and classes) to resolve IDs.
- **`generic_mfiles_request`**: Execute any MFWS REST endpoint with support for method tunneling.
- **`mfiles_objects_search`**: Search objects with support for Quick Search (`q`) and human-readable property filters (e.g. `{ "Customer": "Acme" }`).
- **`mfiles_objects_get`**: Fetch a specific object version.
- **`mfiles_objects_create`**: Create new objects (e.g. Documents).
- **`mfiles_objects_delete`**: Delete objects from the vault.
- **`mfiles_views_list`**: List available vault views.
- **`mfiles_views_get_listing`**: Fetch items within a specific view.
- **`mfiles_structure_propertydefs`**: List all property definitions.
- **`mfiles_structure_classdefs`**: List all class definitions (with multiple fallback endpoints).
- **`mfiles_structure_objecttypes`**: List all object types.
- **`download_file`**: Download files with automatic text extraction for `.txt`, `.md`, and `.pdf` files.
- **`upload_file`**: Upload files to existing objects (handles checkout, temporary upload, and checkin).

## Example Prompts

To get the most out of this MCP server, use multi-step workflows.

### 1. Discovery & Setup
"Discover the M-Files vault schema to see available properties, object types, and classes."

### 2. Search & Retrieval
"Search for documents where the 'Customer' property is 'Acme' and 'Document Date' is in 2025."
"Show me the contents of the 'All Projects' view (ID 101)."

### 3. Creating a Document
> [!IMPORTANT]
> To create an object, you usually need the `Class` ID and any mandatory property IDs. Use `discover_schema` first if you don't have them.

"Create a new document in the 'General Document' class. Set the title to 'Project Plan' and the project property to 'Project Alpha'."

### 4. Working with Files
"Download and read the content of the PDF file (ID 789) attached to document 123."
"Upload a new text file named 'meeting_notes.md' to document 456 with the content 'Draft notes for the kick-off meeting'."

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