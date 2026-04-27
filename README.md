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
  - `/structure`: propertydefs, classdefs, objecttypes
  - `/files`: `download_file` (text extraction where possible) + `upload_file` (spec-correct temp upload flow)
- **Generic escape hatch**: `generic_mfiles_request` for any endpoint not yet covered.
- **Schema discovery**: `discover_schema` loads `/structure/properties` and `/structure/objecttypes`.

## Tools & Verification

Below is a categorized list of all available tools along with sample prompts you can use to verify their functionality.

### 🏗️ Schema & Structure
These tools help the AI understand the vault's metadata, which is often required before performing more complex tasks.

| Tool Name | Purpose | Sample Prompt |
| :--- | :--- | :--- |
| `discover_schema` | Fetches core vault structure (properties/object types). | "Initialize the vault schema so you can resolve property names." |
| `mfiles_structure_propertydefs` | Lists all property definitions. | "Show me a list of all property definitions in the vault." |
| `mfiles_structure_classdefs` | Lists all class definitions. | "List all available classes in M-Files." |
| `mfiles_structure_classdetails` | Gets details for a specific class (e.g., mandatory properties). | "What are the required properties for the 'Customer' class?" |
| `mfiles_structure_objecttypes` | Lists all object types (Documents, Customers, etc.). | "What object types are available in this vault?" |

### 🔍 Search & Objects
Core tools for interacting with data within the M-Files vault.

| Tool Name | Purpose | Sample Prompt |
| :--- | :--- | :--- |
| `mfiles_objects_search` | Search for objects using text or property filters. | "Find all documents with 'Invoice' in the title." or "Search for documents where 'Customer' is 'Acme'." |
| `mfiles_objects_get` | Get detailed metadata for a specific object version. | "Get the full details for Document ID 123." |
| `mfiles_objects_get_properties` | **New:** Get all property values for an object. | "Show me all the property values for Document ID 123." |
| `mfiles_objects_create_simple` | **Recommended** for creating objects using simple names. (Requires `discover_schema` first). | "Create a new Document called 'Project Plan' in the 'Project' class." |
| `mfiles_objects_delete` | Deletes an object from the vault. | "Delete document ID 456." |
| `mfiles_objects_checkout` | Checks out an object to allow for editing or file updates. | "Check out document ID 123 so I can update it." |
| `mfiles_objects_checkin` | Checks in an object to save changes and create a new version. | "Check in document ID 123 version 5." |

### 📁 Files
Tools for reading from and writing to files stored inside M-Files objects.

| Tool Name | Purpose | Sample Prompt |
| :--- | :--- | :--- |
| `download_file` | Reads file content. (Returns text for .txt/.md/.pdf). | "Read the content of the file in document ID 789." |
| `upload_file` | Uploads a new file to an existing object. | "Upload a new text file named 'notes.txt' with the content 'Hello World' to document ID 123." |

### 🛠️ System
| Tool Name | Purpose | Sample Prompt |
| :--- | :--- | :--- |
| `generic_mfiles_request` | Performs a raw REST API call to any M-Files endpoint. | "Use `/server/version.aspx` to tell me the version of M-files" or "Use `/server/vaults.aspx` to get vault information." |

> [!TIP]
> **Best Practice:** Always start with `discover_schema`. This helps the AI map names (like "Customer") to internal IDs, making subsequent prompts much more reliable.


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