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

const INPUT_DIR = path.join(import.meta.dirname, 'input');
const OUTPUT_DIR = path.join(import.meta.dirname, 'output');
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

if (!ELV_API_KEY) {
  console.error('Missing ELV_API_KEY in .env file');
  process.exit(1);
}

if (!VARIANTS || !VARIANTS.length) {
  console.error('Invalid VARIANTS in .env file');
  process.exit(1);
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

function generateVariants(firstName: string, lastName: string, domain: string) {
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
  }).filter((email) => !!email && validate(email));
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

interface ProgressResponse {
  status: string;
  progress: number;
  credits: { charged: number; returned: number };
  name: string;
  createdAt: string;
  updatedAt: string;
}

async function checkProgress(state: State): Promise<void> {
  const fileEntries = Object.entries(state.files);
  if (fileEntries.length === 0) {
    console.log('No files being tracked.\n');
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
      console.log(`    Credits: ${info.credits.charged} charged, ${info.credits.returned} returned`);
      console.log();
    } catch (error) {
      console.log(`  ${filename}: Error checking progress - ${error instanceof Error ? error.message : error}\n`);
    }
  }
  saveState(state);
}

async function processNewFiles(state: State): Promise<void> {
  const inputFiles = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith('.csv'));
  const newFiles = inputFiles.filter((f) => !state.files[f]);

  if (newFiles.length === 0) {
    console.log('No new files to process.\n');
    return;
  }

  console.log(`Found ${newFiles.length} new file(s) to process:\n`);

  for (const filename of newFiles) {
    const originalFile = path.join(INPUT_DIR, filename);
    const timestamp = Date.now();
    const elvInputFilename = `${filename}.${timestamp}.elv.csv`;
    const elvInputFile = path.join(OUTPUT_DIR, elvInputFilename);

    console.log(`Processing: ${filename}`);
    try {
      console.log(`  Generating email variants...`);
      await createElvInputFile(originalFile, elvInputFile);

      const elvId = await uploadFileToElv(elvInputFile);
      console.log(`  Done! ELV ID: ${elvId}\n`);

      state.files[filename] = {
        elvId,
        originalFile: filename,
        elvInputFile: elvInputFilename,
        uploadedAt: new Date().toISOString(),
      };
      saveState(state);
    } catch (error) {
      console.error(`  Error processing ${filename}:`, error instanceof Error ? error.message : error);
      console.log();
    }
  }
}

async function run(): Promise<void> {
  console.log('=== Email List Verify Tool ===\n');

  // Ensure directories exist
  if (!fs.existsSync(INPUT_DIR)) {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const state = loadState();

  // Check progress of existing files
  await checkProgress(state);

  // Process new files
  await processNewFiles(state);

  console.log('Done!');
}

run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
