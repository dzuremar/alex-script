# Email List Verify (ELV) Email Finder Tool

CLI tool that generates email address variants from contact data (first name, last name, domain) and uploads them to the EmailListVerify API for validation.

## How It Works

1. Reads a CSV file with contact information (first name, last name, domain)
2. Generates email variants using configurable templates (e.g., `{first}.{last}@{domain}`)
3. Validates generated emails using `email-validator`
4. Writes all variants to an intermediate file (`<input>.elv.csv`)
5. Uploads the file to EmailListVerify API for bulk verification

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
npm run start -- <csv-file>
```

Note: The `--` is required to pass arguments through npm to the script.

## Input CSV Format

CSV must have headers matching the column names in `.env`:

```csv
First Name,Last Name,Domain
john,smith,example.com
jane,,company.org
```

## Output

- Generates `<input>.elv.csv` with format: `line_number,email`
- Uploads to ELV API and returns a processing file ID

## Scripts

- `npm run start -- <file>` - Run the tool
- `npm run tsc` - Type check
- `npm run lint` - Lint code

## Key Files

- `index.ts` - Main entry point with all logic
- `.env` - Configuration (API key, column names, email templates)
