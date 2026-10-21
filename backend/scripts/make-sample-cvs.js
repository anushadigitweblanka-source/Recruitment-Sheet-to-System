// Writes fictional sample CVs (PDF and DOCX) for trying the CV reader by hand.
// Every person and number in them is made up. Usage:
//   node backend/scripts/make-sample-cvs.js [output-folder]   (default: ./sample-cvs)

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FULL_CV, SPARSE_CV, buildDocx, buildPdf } from '../tests/helpers/fictionalCv.js';

const dir = path.resolve(process.argv[2] ?? 'sample-cvs');
await mkdir(dir, { recursive: true });
const files = {
  'fictional-full-cv.pdf': await buildPdf(FULL_CV),
  'fictional-full-cv.docx': await buildDocx(FULL_CV),
  'fictional-sparse-cv.docx': await buildDocx(SPARSE_CV),
};
for (const [name, buffer] of Object.entries(files)) {
  await writeFile(path.join(dir, name), buffer);
  console.log(path.join(dir, name));
}
