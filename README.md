# Email List Verify (ELV) Email Finder Tool

CLI tool that generates email address variants from contact data (first name, last name, domain) and uploads them to the EmailListVerify API for validation.

## How It Works

1. Scans the `input/` folder for new CSV files
2. For each new file, generates email variants using configurable templates
3. Validates generated emails using `email-validator`
4. Writes variants to `output/<filename>.elv.csv`
5. Uploads the file to EmailListVerify API for bulk verification
6. Stores file IDs in `output/state.json` to track processed files
7. Checks and displays progress of all previously uploaded files

## Directory Structure

```
├── input/           # Place CSV files here for processing
├── output/
│   ├── state.json   # Tracks processed files and their ELV IDs
│   └── *.elv.csv    # Generated email variant files
└── .env             # Configuration
```

## Configuration

Create a `.env` file with:

```
ELV_API_KEY=your_api_key_here
FIRST_NAME_COLUMN=First Name
LAST_NAME_COLUMN=Last Name
DOMAIN_COLUMN=Domain

VARIANTS="
{first}.{last}@{domain}
{last}.{first}@{domain}
{f}.{last}@{domain}
info@{domain}
"
```

### Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{first}` | Full first name | `john` |
| `{last}` | Full last name | `smith` |
| `{f}` | First initial | `j` |
| `{l}` | Last initial | `s` |
| `{domain}` | Full domain | `example.com` |
| `{company}` | Domain without TLD | `example` |

Variants requiring missing data are automatically skipped (e.g., `{first}.{last}@{domain}` is skipped if first name is empty).

## Usage

```bash
npm run start
```

The script will:
1. Check progress of any previously uploaded files
2. Process any new CSV files in `input/`
3. Upload them to ELV and save the file IDs

Run it multiple times to check progress updates.

## Input CSV Format

CSV must have headers matching the column names in `.env`:

```csv
First Name,Last Name,Domain
john,smith,example.com
jane,,company.org
```

## Output

- `output/state.json` - Tracks all processed files:
  ```json
  {
    "files": {
      "contacts.csv": {
        "elvId": 12345,
        "originalFile": "contacts.csv",
        "elvInputFile": "contacts.csv.elv.csv",
        "uploadedAt": "2024-01-08T10:00:00.000Z",
        "progress": {
          "percent": 50,
          "status": "processing",
          "checkedAt": "2024-01-08T10:05:00.000Z"
        }
      }
    }
  }
  ```
- `output/<filename>.elv.csv` - Generated emails with format: `line_number,email`

## Scripts

- `npm run start` - Run the tool
- `npm run tsc` - Type check
- `npm run lint` - Lint code

## Key Files

- `index.ts` - Main entry point with all logic
- `.env` - Configuration (API key, column names, email templates)
- `output/state.json` - Persistent state tracking processed files
