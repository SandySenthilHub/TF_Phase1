import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sql, getPool } from '../config/database.js';
import { exec, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { spawn } from 'child_process';





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

    // ✅ Compute file hash
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

    const pool = await getPool();

    // ✅ Check if the file hash exists for this specific session
    const checkResult = await pool.request()
      .input('FileHash', sql.NVarChar(100), fileHash)
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .query(`
        SELECT Id 
        FROM SB_TF_ingestion_Sets 
        WHERE FileHash = @FileHash AND SessionId = @SessionId
      `);

    if (checkResult.recordset.length > 0) {
      // ❌ Duplicate found — delete temp uploaded file
      fs.unlinkSync(file.path);

      return res.status(409).json({
        error: 'Duplicate document upload detected in this session. This file already exists.'
      });
    }

    // ✅ Insert new record
    const result = await pool.request()
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .input('FileName', sql.NVarChar(255), file.originalname)
      .input('FileType', sql.NVarChar(100), path.extname(file.originalname).substring(1))
      .input('FileSize', sql.Int, file.size)
      .input('FilePath', sql.NVarChar(500), `/uploads/${file.filename}`)
      .input('FileHash', sql.NVarChar(100), fileHash)
      .query(`
        INSERT INTO SB_TF_ingestion_Sets 
        (SessionId, FileName, FileType, FileSize, FilePath, FileHash)
        OUTPUT INSERTED.Id
        VALUES (@SessionId, @FileName, @FileType, @FileSize, @FilePath, @FileHash)
      `);

    const insertedId = result.recordset[0].Id;

    console.log('✅ Document uploaded:', file.originalname);

    res.status(201).json({
      message: 'Document uploaded successfully.',
      fileName: file.originalname,
      id: insertedId
    });

  } catch (err) {
    console.error('❌ Upload failed:', err);
    res.status(500).json({ error: 'Failed to upload and save document.' });
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
        FROM SB_TF_ingestion_Sets
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
        SELECT FilePath FROM SB_TF_ingestion_Sets WHERE Id = @Id
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


router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();

    // Get file + sessionId from the main document
    const result = await pool.request()
      .input('Id', sql.UniqueIdentifier, id)
      .query(`SELECT FilePath, SessionId, Id FROM SB_TF_ingestion_Sets WHERE Id = @Id`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { FilePath, SessionId: sessionId, Id: documentId } = result.recordset[0];
    const fileName = path.basename(FilePath, '.pdf');
    const fullFilePath = path.join(process.cwd(), FilePath);

    const splitFolderPath = path.join(process.cwd(), 'outputs', sessionId, `${fileName}-${documentId}`);
    const groupedFolderPath = path.join(process.cwd(), 'grouped_outputs', sessionId, documentId);

    console.log("🧾 Deleting document ID:", documentId);
    console.log("📁 Uploaded PDF Path:", fullFilePath);
    console.log("📂 Split Folder:", splitFolderPath);
    console.log("📂 Grouped Folder:", groupedFolderPath);

    // Delete uploaded file
    if (fs.existsSync(fullFilePath)) {
      fs.unlinkSync(fullFilePath);
      console.log("🗑️ Uploaded file deleted.");
    } else {
      console.log("⚠️ Uploaded file not found:", fullFilePath);
    }

    // Delete output split folder
    if (fs.existsSync(splitFolderPath)) {
      fs.rmSync(splitFolderPath, { recursive: true, force: true });
      console.log("🧹 Split folder deleted.");
    } else {
      console.log("⚠️ Split folder not found:", splitFolderPath);
    }

    // Delete grouped output folder
    if (fs.existsSync(groupedFolderPath)) {
      fs.rmSync(groupedFolderPath, { recursive: true, force: true });
      console.log("🧹 Grouped folder deleted.");
    } else {
      console.log("⚠️ Grouped folder not found:", groupedFolderPath);
    }

    // Delete all related rows
    const deleteTables = [
      { table: "TF_ingestion_CleanedPDF", col: "document_id" },
      { table: "TF_ingestion_CleanedOCR", col: "document_id" },
      { table: "TF_ingestion_mGroupsPDF", col: "document_id" },
      { table: "TF_ingestion_mGroupsOCR", col: "document_id" },
      { table: "TF_ingestion_mGroupsFields", col: "document_id" },
      { table: "TF_mdocs_mgroups", col: "document_id" }
    ];

    for (const { table, col } of deleteTables) {
      const del = await pool.request()
        .input('document_id', sql.UniqueIdentifier, documentId)
        .query(`DELETE FROM ${table} WHERE ${col} = @document_id`);
      console.log(`🗑️ Deleted ${del.rowsAffected[0]} rows from ${table}`);
    }

    // Finally delete from main table
    await pool.request()
      .input('Id', sql.UniqueIdentifier, id)
      .query(`DELETE FROM SB_TF_ingestion_Sets WHERE Id = @Id`);
    console.log('✅ Document record deleted from SB_TF_ingestion_Sets');

    res.status(200).json({ message: '✅ Document and all related data deleted successfully.' });
  } catch (error) {
    console.error('❌ Delete document failed:', error);
    res.status(500).json({ error: 'Failed to delete document and related data.' });
  }
});







// Call Python splitter from Node
// router.post('/split/:sessionId', async (req, res) => {
//   const { sessionId } = req.params;
//   const { filePath, documentId } = req.body;

//   // Fix the full path here
//   const serverRoot = path.join(__dirname, '..', '..');
//   const actualUploadDir = path.join(serverRoot, 'uploads'); // 🛠 Correct folder name
//   const scriptPath = path.join(__dirname, '..', 'python', 'split_OCR.py'); // ✅ Define scriptPath here
//   const absoluteFilePath = path.join(actualUploadDir, path.basename(filePath));

//   // Optional: Log to confirm
//   console.log("✅ File to split:", absoluteFilePath);

//   if (!fs.existsSync(absoluteFilePath)) {
//     return res.status(400).json({ error: `❌ File not found: ${absoluteFilePath}` });
//   }

//   // Run Python with correct file path
//   // const command = `python "${scriptPath}" "${absoluteFilePath}" "${sessionId}" "${documentId}"`;

//   const ocrMethod = req.body.ocrMethod || 'tesseract'; // default if not passed
//   const command = `python "${scriptPath}" "${absoluteFilePath}" "${sessionId}" "${documentId}" "${ocrMethod}"`;


//   console.log("📂 Running split command:", command);

//   exec(command, (err, stdout, stderr) => {
//     console.log("📤 Python STDOUT:\n", stdout);
//     console.error("📛 Python STDERR:\n", stderr);

//     if (err) {
//       return res.status(500).json({
//         error: 'Python split failed',
//         stderr,
//         stdout,
//       });
//     }

//     try {
//       const outputDir = path.join(
//         __dirname,
//         '..',
//         '..',
//         'outputs',
//         sessionId,
//         `${path.basename(filePath, '.pdf')}-${documentId}`
//       );

//       // ✅ Return relative paths suitable for FE
//       const files = fs.readdirSync(outputDir)
//         .filter(f => f.endsWith('.pdf') && f !== 'original.pdf')
//         .map(f => ({
//           fileName: f,
//           name: f,
//           pdfPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${f}`,
//           textPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${f.replace('.pdf', '.txt')}`,
//         }));

//       for (const file of files) {
//         const textAbsPath = path.join(serverRoot, file.textPath); // Full .txt file path
//         const extractScript = path.join(__dirname, '..', 'python', 'extract_fields.py');
//         const extractCmd = `python "${extractScript}" "${textAbsPath}"`;

//         // console.log("📤 Extracting fields from:", textAbsPath);
//         try {
//           execSync(extractCmd);
//         } catch (exErr) {
//           console.error("❌ Field extraction failed:", exErr.message);
//         }
//       }


//       return res.status(200).json({
//         message: 'Document split successfully',
//         output: stdout,
//         files: files,
//       });
//     } catch (fileErr) {
//       console.error('❌ Error reading split files:', fileErr);
//       return res.status(500).json({ error: 'Split succeeded but reading output failed' });
//     }
//   });
// });

router.post('/split/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, documentId, ocrMethod = 'azure' } = req.body;

  const serverRoot = path.join(__dirname, '..', '..');
  const actualUploadDir = path.join(serverRoot, 'uploads');
  const scriptPath = path.join(__dirname, '..', 'python', 'split_OCR.py');
  const absoluteFilePath = path.join(actualUploadDir, path.basename(filePath));

  console.log("✅ File to split:", absoluteFilePath);

  if (!fs.existsSync(absoluteFilePath)) {
    return res.status(400).json({ error: `❌ File not found: ${absoluteFilePath}` });
  }

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
        serverRoot,
        'outputs',
        sessionId,
        `${path.basename(filePath, '.pdf')}-${documentId}`
      );

      if (!fs.existsSync(outputDir)) {
        return res.status(404).json({ error: '❌ Output folder not found after split.' });
      }

      const files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.pdf') && f !== 'original.pdf')
        .map(f => {
          const baseName = f.replace('.pdf', '');
          return {
            fileName: f,
            name: f,
            pdfPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${f}`,
            textPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${baseName}.txt`,
            jsonPath: `/outputs/${sessionId}/${path.basename(filePath, '.pdf')}-${documentId}/${baseName}.fields.json`,
          };
        });

      return res.status(200).json({
        message: '✅ Document split and processed successfully',
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
      .query(`SELECT FilePath, SessionId FROM SB_TF_ingestion_Sets WHERE Id = @Id`);

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


// Call python grouping 

router.post('/group/:sessionId/:documentId', async (req, res) => {
  const { sessionId, documentId } = req.params;
  const scriptPath = path.join(__dirname, '..', 'python', 'group_by_form.py');

  try {
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: 'Grouping script not found.' });
    }

    // ✅ Add '--group' as the first argument
    const pythonProcess = spawn('python', [scriptPath, sessionId, documentId]);

    pythonProcess.stdout.on('data', data => {
      console.log(`[GROUPING STDOUT]: ${data}`);
    });

    pythonProcess.stderr.on('data', data => {
      console.error(`[GROUPING STDERR]: ${data}`);
    });

    pythonProcess.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ Grouping script finished successfully.`);
        res.json({ message: "Grouping completed." });
      } else {
        console.error(`❌ Grouping script exited with code ${code}`);
        res.status(500).json({ error: "Grouping script failed to execute." });
      }
    });

  } catch (err) {
    console.error('❌ Grouping failed:', err);
    res.status(500).json({ error: 'Internal server error during grouping.' });
  }
});

router.get('/grouped-files/:sessionId/:documentId', (req, res) => {
  const { sessionId, documentId } = req.params;

  const groupedBasePath = path.join(
    __dirname,
    '..',
    '..',
    'grouped',
    sessionId,
    documentId
  );

  if (!fs.existsSync(groupedBasePath)) {
    return res.status(404).json({ error: 'Grouped folder not found' });
  }

  const forms = fs.readdirSync(groupedBasePath).filter(formName => {
    const formPath = path.join(groupedBasePath, formName);
    return fs.existsSync(formPath) && fs.statSync(formPath).isDirectory();
  });

  return res.json({ forms });
});


// Call pyton catalog

router.post('/catalog', async (req, res) => {
  try {
    const { session_id, document_id } = req.body;

    if (!session_id || !document_id) {
      return res.status(400).json({ error: 'session_id and document_id are required' });
    }

    const scriptPath = path.join(__dirname, "..", "python", "catalog_with_master.py");
    const pythonProcess = spawn('python', [scriptPath, session_id, document_id]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('[Catalog Success]:', stdout);
        return res.status(200).json({ success: true, output: stdout });
      } else {
        console.error('[Catalog Error]:', stderr);
        return res.status(500).json({ success: false, error: stderr });
      }
    });
  } catch (err) {
    console.error('[Catalog Fatal Error]:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


router.get('/cataloged-documents/:sessionId/:documentId', async (req, res) => {
  const { sessionId, documentId } = req.params;

  if (!sessionId || !documentId) {
    return res.status(400).json({ success: false, message: "Missing sessionId or documentId" });
  }

  try {
    const pool = await getPool(); // ✅ Use your shared pool

    const result = await pool.request()
      .input('session_id', sql.VarChar, sessionId)
      .input('document_id', sql.VarChar, documentId)
      .query(`
        SELECT id, session_id, document_id, grouped_form_type,
               matched_document_name, matched_document_id,
               confidence_score, cataloged_at
        FROM TF_mdocs_mgroups
        WHERE session_id = @session_id AND document_id = @document_id
        ORDER BY cataloged_at DESC
      `);

    return res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Catalog fetch error:', error);
    return res.status(500).json({ success: false, message: error.message });
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
