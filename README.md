# Email List Verify (ELV) Email Finder Tool

CLI tool that generates email address variants from contact data (first name, last name, domain), validates them via EmailListVerify API, and produces a final CSV with verified emails.

## How It Works

1. Scans the `input/` folder for new CSV files
2. For each new file, prompts user to:
   - Confirm the file has headers (skips if no headers)
   - Select which column contains First Name
   - Select which column contains Last Name
   - Select which column contains Domain
3. Generates email variants using configurable templates
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
└── config.json      # Configuration
```

## Configuration

Copy `config.example.json` to `config.json` and fill in your API key:

```json
{
  "elvApiKey": "your_api_key_here",
  "variants": [
    "{first}.{last}@{domain}",
    "{last}.{first}@{domain}",
    "{f}.{last}@{domain}",
    "info@{domain}"
  ]
}
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

The script is interactive. For each new file, it will prompt you to:

```
Processing: contacts.csv
  Does this file have headers? (y/n): y
  Found 5 columns in file.

  Available columns:
    1. Name
    2. Surname
    3. Company
    4. Website
    5. Phone
    0. None / Skip
  Which column is the First Name? (enter number): 1

  Available columns:
    1. Name
    2. Surname
    ...
  Which column is the Last Name? (enter number): 2

  Available columns:
    ...
  Which column is the Domain? (enter number): 4

  Column mapping:
    First Name: Name
    Last Name: Surname
    Domain: Website

  Generating email variants...
  Uploading file to ELV...
  Done! ELV ID: 12345
```

Run the script periodically to check progress and download completed results.

## Input CSV Format

CSV files must have headers. Any column names are supported - you'll be prompted to map them:

```csv
Name,Surname,Company,Website
john,smith,Acme Inc,acme.com
jane,doe,Tech Corp,techcorp.io
```

## Output

Final output files are saved to `output/<filename>.csv` with a new "Verified Emails" column:

```csv
Name,Surname,Company,Website,Verified Emails
john,smith,Acme Inc,acme.com,"john.smith@acme.com
info@acme.com"
jane,doe,Tech Corp,techcorp.io,info@techcorp.io
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
      "columnMapping": {
        "firstNameColumn": "Name",
        "lastNameColumn": "Surname",
        "domainColumn": "Website"
      },
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
- `config.json` - Configuration (API key, email templates)
- `output/state.json` - Tracks files pending ELV processing
