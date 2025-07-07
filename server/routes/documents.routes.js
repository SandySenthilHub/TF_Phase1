import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sql, getPool } from '../config/database.js';
import { exec, execSync } from 'child_process';

import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const router = express.Router();

// Ensure the uploads directory exists
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Upload Route
router.post('/upload/:sessionId', upload.single('document'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Extract file info
    const fileName = file.originalname;
    const fileType = path.extname(file.originalname).substring(1); // remove dot
    const fileSize = file.size;
    const filePath = `/uploads/${file.filename}`;  // ✅ relative path usable by frontend

    const pool = await getPool(); // ✅ Add this before using pool

    const result = await pool.request()
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .input('FileName', sql.NVarChar(255), fileName)
      .input('FileType', sql.NVarChar(100), fileType)
      .input('FileSize', sql.Int, fileSize)
      .input('FilePath', sql.NVarChar(500), `/uploads/${file.filename}`)
      .query(`
    INSERT INTO TF_ingestion_raw (SessionId, FileName, FileType, FileSize, FilePath)
    OUTPUT INSERTED.Id
    VALUES (@SessionId, @FileName, @FileType, @FileSize, @FilePath)
  `);

    const insertedId = result.recordset[0].Id;

    console.log('✅ Document inserted into TF_ingestion_raw:', file.filename);

    res.status(201).json({
      message: 'Document uploaded and saved to TF_ingestion_raw successfully.',
      fileName: file.originalname,
      savedAs: file.filename,
      id: insertedId
    });

  } catch (err) {
    console.error('❌ Upload failed:', err);
    res.status(500).json({ error: 'Failed to upload and save document' });
  }
});


// ✅ Get all documents for a session
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .query(`
        SELECT Id, FileName, FileType, FileSize, FilePath, UploadedAt
        FROM TF_ingestion_raw
        WHERE SessionId = @SessionId
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('❌ Failed to fetch documents by session:', error);
    res.status(500).json({ error: 'Failed to fetch documents for the session' });
  }
});


// ✅ Serve PDF by document ID
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input('Id', sql.UniqueIdentifier, id)
      .query(`
        SELECT FilePath FROM TF_ingestion_raw WHERE Id = @Id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const filePath = result.recordset[0].FilePath;
    const absolutePath = path.join(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(absolutePath);
  } catch (err) {
    console.error(' Failed to serve PDF:', err);
    res.status(500).json({ error: 'Failed to load PDF document' });
  }
});


//  DELETE a document by ID
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();

    // Get the file path before deleting DB record
    const fileResult = await pool.request()
      .input('Id', sql.UniqueIdentifier, id)
      .query('SELECT FilePath FROM TF_ingestion_raw WHERE Id = @Id');

    if (fileResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const filePath = fileResult.recordset[0].FilePath;
    const fullFilePath = path.join(process.cwd(), filePath); // Resolve full path from DB value

    // Delete file from disk
    if (fs.existsSync(fullFilePath)) {
      fs.unlinkSync(fullFilePath);
    }

    // Delete record from DB
    await pool.request()
      .input('Id', sql.UniqueIdentifier, id)
      .query('DELETE FROM TF_ingestion_raw WHERE Id = @Id');

    console.log(' Document deleted:', id);

    res.status(200).json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document failed:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});


// Call Python splitter from Node
router.post('/split/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, documentId } = req.body;

  // Fix the full path here
  const serverRoot = path.join(__dirname, '..', '..');
  const actualUploadDir = path.join(serverRoot, 'uploads'); // 🛠 Correct folder name
  const scriptPath = path.join(__dirname, '..', 'python', 'split_by_form_azure.py'); // ✅ Define scriptPath here
  const absoluteFilePath = path.join(actualUploadDir, path.basename(filePath));

  // Optional: Log to confirm
  console.log("✅ File to split:", absoluteFilePath);

  if (!fs.existsSync(absoluteFilePath)) {
    return res.status(400).json({ error: `❌ File not found: ${absoluteFilePath}` });
  }

  // Run Python with correct file path
  // const command = `python "${scriptPath}" "${absoluteFilePath}" "${sessionId}" "${documentId}"`;

  const ocrMethod = req.body.ocrMethod || 'tesseract'; // default if not passed
  const command = `python "${scriptPath}" "${absoluteFilePath}" "${sessionId}" "${documentId}" "${ocrMethod}"`;


  console.log("📂 Running split command:", command);

  exec(command, (err, stdout, stderr) => {
    console.log("📤 Python STDOUT:\n", stdout);
    console.error("📛 Python STDERR:\n", stderr);

    if (err) {
      return res.status(500).json({
        error: 'Python split failed',
        stderr,
        stdout,
      });
    }

    try {
      const outputDir = path.join(
        __dirname,
        '..',
        '..',
        'outputs',
        sessionId,
        `${path.basename(filePath, '.pdf')}-${documentId}`
      );

      // ✅ Return relative paths suitable for FE
      const files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.pdf') && f !== 'original.pdf')
        .map(f => ({
          fileName: f,
          name: f,
          pdfPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${f}`,
          textPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${f.replace('.pdf', '.txt')}`,
        }));

      for (const file of files) {
        const textAbsPath = path.join(serverRoot, file.textPath); // Full .txt file path
        const extractScript = path.join(__dirname, '..', 'python', 'extract_fields.py');
        const extractCmd = `python "${extractScript}" "${textAbsPath}"`;

        console.log("📤 Extracting fields from:", textAbsPath);
        try {
          execSync(extractCmd);
        } catch (exErr) {
          console.error("❌ Field extraction failed:", exErr.message);
        }
      }


      return res.status(200).json({
        message: 'Document split successfully',
        output: stdout,
        files: files,
      });
    } catch (fileErr) {
      console.error('❌ Error reading split files:', fileErr);
      return res.status(500).json({ error: 'Split succeeded but reading output failed' });
    }
  });
});

router.get('/:id/pdf-info', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input('Id', sql.UniqueIdentifier, id)
      .query(`SELECT FilePath, SessionId FROM TF_ingestion_raw WHERE Id = @Id`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { FilePath, SessionId } = result.recordset[0];
    res.status(200).json({ filePath: FilePath, sessionId: SessionId });
  } catch (err) {
    console.error(' Failed to get file info:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /api/documents/split/session/:sessionId
router.get('/split/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const baseDir = path.resolve(__dirname, '..', '..', 'outputs', sessionId);

  if (!fs.existsSync(baseDir)) {
    return res.status(404).json({ error: 'No split files found for this session' });
  }

  const result = [];

  const folders = fs.readdirSync(baseDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const folder of folders) {
    const folderPath = path.join(baseDir, folder.name);
    const files = fs.readdirSync(folderPath);
    const splitFiles = files.filter(f => f.endsWith('.pdf') && f !== 'original.pdf');

    result.push({
      documentId: folder.name,
      files: splitFiles.map(name => ({
        fileName: name,
        pdfPath: `/outputs/${sessionId}/${folder.name}/${name}`,
        textPath: `/outputs/${sessionId}/${folder.name}/${name.replace('.pdf', '.txt')}`
      }))
    });
  }

  res.json({ results: result });
});


// GET /api/documents/split/:documentId
router.get('/split/:documentId', async (req, res) => {
  const documentId = req.params.documentId;
  const outputsPath = path.resolve(__dirname, '..', '..', 'outputs');
  let found = null;

  // Go through each session folder
  const sessionFolders = fs.readdirSync(outputsPath);
  for (const sessionId of sessionFolders) {
    const sessionPath = path.join(outputsPath, sessionId);
    const docFolders = fs.readdirSync(sessionPath);
    for (const docFolder of docFolders) {
      if (docFolder.endsWith(documentId)) {
        const docPath = path.join(sessionPath, docFolder);
        const files = fs.readdirSync(docPath).filter(f => f.endsWith('.pdf') || f.endsWith('.txt'));
        found = files.map(file => ({
          fileName: file,
          filePath: `/outputs/${sessionId}/${docFolder}/${file}`,
          type: file.endsWith('.pdf') ? 'pdf' : 'text',
        }));
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    return res.status(404).json({ error: 'No split files found for this document' });
  }

  res.json(found);
});



router.get('/:sessionId/:fileName/fields', async (req, res) => {
  const { sessionId, fileName } = req.params;

  const serverRoot = path.join(__dirname, '..', '..');
  const outputsBase = path.join(serverRoot, 'outputs', sessionId);

  // Try to find the matching subfolder
  const subdirs = fs.readdirSync(outputsBase, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(outputsBase, dirent.name));

  let fieldsPath = null;

  for (const dir of subdirs) {
    const possible = path.join(dir, fileName.replace('.pdf', '.fields.json'));
    if (fs.existsSync(possible)) {
      fieldsPath = possible;
      break;
    }
  }

  if (!fieldsPath) {
    return res.status(404).json({ error: `❌ fields.json not found for ${fileName}` });
  }

  try {
    const raw = fs.readFileSync(fieldsPath, 'utf-8');
    const fields = JSON.parse(raw);
    res.json({ fields });
  } catch (err) {
    console.error(`❌ Error reading fields for ${fileName}:`, err);
    res.status(500).json({ error: 'Failed to read fields JSON' });
  }
});





export default router;
