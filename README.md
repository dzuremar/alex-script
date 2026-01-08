# Email List Verify (ELV) Email Finder Tool

CLI tool that generates email address variants from contact data (first name, last name, domain), validates them via EmailListVerify API, and produces a final CSV with verified emails.

## How It Works

1. Scans the `input/` folder for new CSV files
2. For each new file, generates email variants using configurable templates
3. Validates generated emails using `email-validator`
4. Uploads variants to EmailListVerify API for bulk verification
5. Tracks file IDs in `output/state.json` while processing
6. When ELV processing is complete, downloads results
7. Merges verified emails (status "ok") back into the original CSV
8. Outputs final CSV to `output/` with a new "Verified Emails" column

## Directory Structure

```
├── input/           # Place CSV files here for processing
├── output/
│   ├── state.json   # Tracks files currently being processed by ELV
│   └── *.csv        # Final output files with verified emails
├── tmp/             # Temporary files (auto-cleaned after upload)
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
1. Check progress of any files being processed by ELV
2. Download and merge results for finished files
3. Process any new CSV files in `input/`

Run it periodically until all files are processed.

## Input CSV Format

CSV must have headers matching the column names in `.env`:

```csv
First Name,Last Name,Domain
john,smith,example.com
jane,,company.org
```

## Output

Final output files are saved to `output/<filename>.csv` with a new "Verified Emails" column:

```csv
First Name,Last Name,Domain,Verified Emails
john,smith,example.com,"john.smith@example.com
info@example.com"
jane,,company.org,info@company.org
```

Multiple verified emails are newline-delimited within the cell.

### State File

`output/state.json` tracks files currently being processed:

```json
{
  "files": {
    "contacts.csv": {
      "elvId": 12345,
      "originalFile": "contacts.csv",
      "uploadedAt": "2024-01-08T10:00:00.000Z"
    }
  }
}
```

Files are removed from state after successful processing.

## Scripts

- `npm run start` - Run the tool
- `npm run tsc` - Type check
- `npm run lint` - Lint code

## Key Files

- `index.ts` - Main entry point with all logic
- `.env` - Configuration (API key, column names, email templates)
- `output/state.json` - Tracks files pending ELV processing
