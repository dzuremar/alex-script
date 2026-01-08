import 'dotenv/config';
import axios from 'axios';
import * as fs from 'fs';
import * as csv from 'fast-csv';
import { fileFromPath } from 'formdata-node/file-from-path';
import { FormData } from 'formdata-node';
import { validate } from 'email-validator';

const ELV_API_URL = `https://api.emaillistverify.com/api/verifyApiFile?secret=${process.env.ELV_API_KEY}`;
const VARIANTS = process.env.VARIANTS?.split('\n').filter(Boolean) || [];

if (!VARIANTS || !VARIANTS.length) {
  console.error('Invalid VARIANTS in .env file');
  process.exit(1);
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

async function uploadFileToElv(file: string) {
  console.log(`Uploading file ${file} to ELV ...`);
  const data = new FormData();
  const contents = await fileFromPath(file);
  data.append('file_contents', contents);
  const response = await axios.post(ELV_API_URL, data);
  return parseInt(response.data);
}

async function createElvInputFile(originalFile: string, elvInputFile: string) {
  const writeStream = fs.createWriteStream(elvInputFile);
  let line = 0;
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(originalFile)
      .pipe(csv.parse({ headers: true }))
      .pipe(csv.format({ headers: true }))
      .transform((row, next) => {
        ++line;
        const firstName = process.env.FIRST_NAME_COLUMN && row[process.env.FIRST_NAME_COLUMN];
        const lastName = process.env.LAST_NAME_COLUMN && row[process.env.LAST_NAME_COLUMN];
        const domain = process.env.DOMAIN_COLUMN && row[process.env.DOMAIN_COLUMN];
        const generatedVariants = generateVariants(firstName, lastName, domain);
        for (const email of generatedVariants) {
          writeStream.write(`${line},${email}\r\n`);
        }
        next(null);
      })
      .on('end', () => resolve())
      .on('error', (error) => reject(error));
  });
}

async function run(originalFile: string) {
  try {
    const elvInputFile = `${originalFile}.elv.csv`;
    console.log(`Generating ELV input file ...`);
    await createElvInputFile(originalFile, elvInputFile);
    console.log('Done, generated file: ', elvInputFile);
    console.log('Uploading generated file to ELV ...');
    const id = await uploadFileToElv(elvInputFile);
    console.log('Done, processing file ID: ', id);
  } catch (error) {
    console.error('Error occured: ', error);
    process.exit(1);
  }
}

const inputFile = process.argv[2];
if (inputFile) {
  console.log('Input CSV file: ', inputFile);
} else {
  console.error('Please provide input CSV file path as the first argument');
  process.exit(1);
}
run(process.argv[2]);
