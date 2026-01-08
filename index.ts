import 'dotenv/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'fast-csv';
import { fileFromPath } from 'formdata-node/file-from-path';
import { FormData } from 'formdata-node';
import { validate } from 'email-validator';

const ELV_API_KEY = process.env.ELV_API_KEY;
const ELV_UPLOAD_URL = `https://api.emaillistverify.com/api/verifyApiFile?secret=${ELV_API_KEY}`;
const ELV_PROGRESS_URL = (id: number) => `https://api.emaillistverify.com/api/maillists/${id}/progress?secret=${ELV_API_KEY}`;
const ELV_DOWNLOAD_URL = (id: number) => `https://api.emaillistverify.com/api/maillists/${id}?secret=${ELV_API_KEY}`;

const INPUT_DIR = path.join(import.meta.dirname, 'input');
const OUTPUT_DIR = path.join(import.meta.dirname, 'output');
const TMP_DIR = path.join(import.meta.dirname, 'tmp');
const STATE_FILE = path.join(OUTPUT_DIR, 'state.json');

const VARIANTS = process.env.VARIANTS?.split('\n').filter(Boolean) || [];

interface FileState {
  elvId: number;
  originalFile: string;
  elvInputFile: string;
  uploadedAt: string;
  progress?: {
    percent: number;
    status: string;
    checkedAt: string;
  };
}

interface State {
  files: Record<string, FileState>;
}

interface ProgressResponse {
  status: string;
  progress: number;
  credits: { charged: number; returned: number };
  name: string;
  createdAt: string;
  updatedAt: string;
}

if (!ELV_API_KEY) {
  console.error('Missing ELV_API_KEY in .env file');
  process.exit(1);
}

if (!VARIANTS || !VARIANTS.length) {
  console.error('Invalid VARIANTS in .env file');
  process.exit(1);
}

function ensureDirectories(): void {
  for (const dir of [INPUT_DIR, OUTPUT_DIR, TMP_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function loadState(): State {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return { files: {} };
}

function saveState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function cleanupTmpFile(filename: string): void {
  const filepath = path.join(TMP_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}

function generateVariants(firstName: string, lastName: string, domain: string): string[] {
  return VARIANTS.map((variant) => {
    if (firstName) {
      variant = variant.replace(/{first}/g, firstName).replace(/{f}/g, firstName.charAt(0));
    } else if (/{first}|{f}/.test(variant)) {
      return;
    }
    if (lastName) {
      variant = variant.replace(/{last}/g, lastName).replace(/{l}/g, lastName.charAt(0));
    } else if (/{last}|{l}/.test(variant)) {
      return;
    }
    if (domain) {
      const company = domain.split('.')[0];
      variant = variant.replace(/{company}/g, company);
      variant = variant.replace(/{domain}/g, domain);
    } else if (/{domain}|{company}/.test(variant)) {
      return;
    }
    return variant;
  }).filter((email): email is string => !!email && validate(email));
}

async function uploadFileToElv(file: string): Promise<number> {
  console.log(`  Uploading file to ELV...`);
  const data = new FormData();
  const contents = await fileFromPath(file);
  data.append('file_contents', contents);
  try {
    const response = await axios.post(ELV_UPLOAD_URL, data);
    return parseInt(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`ELV API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function createElvInputFile(originalFile: string, elvInputFile: string): Promise<void> {
  const writeStream = fs.createWriteStream(elvInputFile);
  let line = 0;
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(originalFile);
    const parseStream = readStream.pipe(csv.parse({ headers: true }));

    parseStream
      .on('data', (row) => {
        ++line;
        const firstName = process.env.FIRST_NAME_COLUMN && row[process.env.FIRST_NAME_COLUMN];
        const lastName = process.env.LAST_NAME_COLUMN && row[process.env.LAST_NAME_COLUMN];
        const domain = process.env.DOMAIN_COLUMN && row[process.env.DOMAIN_COLUMN];
        const generatedVariants = generateVariants(firstName, lastName, domain);
        for (const email of generatedVariants) {
          writeStream.write(`${line},${email}\r\n`);
        }
      })
      .on('end', () => {
        writeStream.end(() => resolve());
      })
      .on('error', (error) => reject(error));
  });
}

async function downloadResults(elvId: number): Promise<Map<number, string[]>> {
  const response = await axios.get(ELV_DOWNLOAD_URL(elvId));
  const lines = (response.data as string).split('\n');

  // Group valid emails by line number
  const emailsByLine = new Map<number, string[]>();

  for (const line of lines) {
    if (!line.trim() || line.startsWith('ELV Result')) continue;

    const parts = line.split(',');
    if (parts.length < 3) continue;

    const [result, lineNumStr, email] = parts;
    if (result !== 'ok') continue;

    const lineNum = parseInt(lineNumStr);
    if (isNaN(lineNum)) continue;

    if (!emailsByLine.has(lineNum)) {
      emailsByLine.set(lineNum, []);
    }
    emailsByLine.get(lineNum)!.push(email.trim());
  }

  return emailsByLine;
}

async function mergeResultsWithOriginal(
  originalFile: string,
  emailsByLine: Map<number, string[]>,
  outputFile: string
): Promise<void> {
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(originalFile)
      .pipe(csv.parse({ headers: true }))
      .on('headers', (h: string[]) => {
        headers = h;
      })
      .on('data', (row: Record<string, string>) => {
        rows.push(row);
      })
      .on('end', () => resolve())
      .on('error', (error) => reject(error));
  });

  // Add new column header
  const outputHeaders = [...headers, 'Verified Emails'];

  const writeStream = fs.createWriteStream(outputFile);
  const csvStream = csv.format({ headers: true });
  csvStream.pipe(writeStream);

  for (let i = 0; i < rows.length; i++) {
    const lineNum = i + 1;
    const emails = emailsByLine.get(lineNum) || [];
    const outputRow: Record<string, string> = {};

    for (const header of headers) {
      outputRow[header] = rows[i][header];
    }
    outputRow['Verified Emails'] = emails.join('\n');

    csvStream.write(outputRow);
  }

  await new Promise<void>((resolve) => {
    csvStream.end(() => resolve());
  });
}

async function processFinishedFiles(state: State): Promise<void> {
  const fileEntries = Object.entries(state.files);
  if (fileEntries.length === 0) {
    return;
  }

  console.log('Checking progress of tracked files:\n');

  for (const [filename, fileState] of fileEntries) {
    try {
      const response = await axios.get<ProgressResponse>(ELV_PROGRESS_URL(fileState.elvId));
      const info = response.data;

      fileState.progress = {
        percent: info.progress,
        status: info.status,
        checkedAt: new Date().toISOString(),
      };

      console.log(`  ${filename}:`);
      console.log(`    ELV ID: ${fileState.elvId}`);
      console.log(`    Status: ${info.status}`);
      console.log(`    Progress: ${info.progress}%`);

      if (info.status === 'finished') {
        console.log(`    Downloading and processing results...`);

        const originalFile = path.join(INPUT_DIR, filename);
        const outputFile = path.join(OUTPUT_DIR, filename);

        const emailsByLine = await downloadResults(fileState.elvId);
        await mergeResultsWithOriginal(originalFile, emailsByLine, outputFile);

        // Remove from state after successful processing
        delete state.files[filename];
        saveState(state);

        console.log(`    Output saved to: output/${filename}`);
      }

      console.log();
    } catch (error) {
      console.log(`  ${filename}: Error - ${error instanceof Error ? error.message : error}\n`);
    }
  }

  saveState(state);
}

async function processNewFiles(state: State): Promise<void> {
  const inputFiles = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith('.csv'));
  const newFiles = inputFiles.filter((f) => !state.files[f] && !fs.existsSync(path.join(OUTPUT_DIR, f)));

  if (newFiles.length === 0) {
    console.log('No new files to process.\n');
    return;
  }

  console.log(`Found ${newFiles.length} new file(s) to process:\n`);

  for (const filename of newFiles) {
    const originalFile = path.join(INPUT_DIR, filename);
    const timestamp = Date.now();
    const elvInputFilename = `${filename}.${timestamp}.elv.csv`;
    const elvInputFile = path.join(TMP_DIR, elvInputFilename);

    console.log(`Processing: ${filename}`);
    try {
      console.log(`  Generating email variants...`);
      await createElvInputFile(originalFile, elvInputFile);

      const elvId = await uploadFileToElv(elvInputFile);
      console.log(`  Done! ELV ID: ${elvId}`);

      // Clean up tmp file after successful upload
      cleanupTmpFile(elvInputFilename);
      console.log(`  Cleaned up temporary file.`);

      state.files[filename] = {
        elvId,
        originalFile: filename,
        elvInputFile: elvInputFilename,
        uploadedAt: new Date().toISOString(),
      };
      saveState(state);
      console.log();
    } catch (error) {
      console.error(`  Error processing ${filename}:`, error instanceof Error ? error.message : error);
      // Clean up tmp file on error too
      cleanupTmpFile(elvInputFilename);
      console.log();
    }
  }
}

async function run(): Promise<void> {
  console.log('=== Email List Verify Tool ===\n');

  ensureDirectories();

  const state = loadState();

  // Check progress and process finished files
  await processFinishedFiles(state);

  // Process new files
  await processNewFiles(state);

  console.log('Done!');
}

run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
