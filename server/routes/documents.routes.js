import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sql, getPool } from '../config/database.js';
import { exec, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { spawn } from 'child_process';


import OpenAI from "openai";





const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const router = express.Router();


const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


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


// Lifecycle

router.post('/lifecycles/:id/add-documents', async (req, res) => {
  const { id } = req.params; // ID of lifecycle (integer)
  const { required_documents } = req.body; // Array of document names

  if (!required_documents || !Array.isArray(required_documents) || !required_documents.length) {
    return res.status(400).json({ error: 'At least one document is required.' });
  }

  try {
    const pool = await getPool();

    // Get existing Required_Documents
    const existing = await pool.request()
      .input('id', parseInt(id))
      .query(`SELECT ISNULL(Required_Documents, '') AS Required_Documents FROM Life_cycle WHERE ID = @id`);

    if (!existing.recordset.length) {
      return res.status(404).json({ error: 'Lifecycle not found.' });
    }

    let docs = existing.recordset[0].Required_Documents
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    // Add new documents, avoid duplicates
    required_documents.forEach((doc) => {
      if (!docs.includes(doc.trim())) docs.push(doc.trim());
    });

    // Update the row
    await pool.request()
      .input('id', parseInt(id))
      .input('docs', docs.join(', '))
      .query(`UPDATE Life_cycle SET Required_Documents = @docs WHERE ID = @id`);

    res.status(200).json({ message: 'Documents updated successfully.', required_documents: docs });
  } catch (err) {
    console.error('❌ Failed to add/update documents:', err);
    res.status(500).json({ error: 'Server error while updating documents.' });
  }
});


router.delete("/lifecycles/:id/delete-document", async (req, res) => {
  const { id } = req.params;
  const { document_name } = req.body;

  if (!id || !document_name) {
    return res.status(400).json({ message: "Missing id or document_name" });
  }

  try {
    const pool = await getPool();

    // Fetch current Required_Documents
    const result = await pool.request()
      .input("ID", sql.Int, Number(id))
      .query("SELECT Required_Documents FROM Life_cycle WHERE ID = @ID");

    const row = result.recordset[0];
    if (!row) {
      return res.status(404).json({ message: "Lifecycle not found" });
    }

    // Normalize current docs
    const currentDocs = row.Required_Documents
      ? row.Required_Documents.split(",").map(d => d.trim())
      : [];

    console.log("Current Docs in DB:", currentDocs);
    console.log("Deleting:", document_name);

    // Remove document (case-insensitive)
    const updatedDocs = currentDocs.filter(
      d => d.toLowerCase() !== document_name.trim().toLowerCase()
    );

    console.log("Updated Docs after deletion:", updatedDocs);

    // Update DB
    const updateResult = await pool.request()
      .input("ID", sql.Int, Number(id))
      .input("Required_Documents", sql.NVarChar, updatedDocs.join(", "))
      .query("UPDATE Life_cycle SET Required_Documents = @Required_Documents WHERE ID = @ID");

    if (updateResult.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "No rows updated. Check ID." });
    }

    res.json({ message: `Document '${document_name}' deleted successfully` });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/lifecycles", async (req, res) => {
  try {
    const pool = await getPool();


    const result = await pool.request().query(`
      SELECT 
        Code,
        Instrument,
        Transition, 
        Applicable_Documents,
        SWIFT_Messages,
        ID,
        Required_Documents
      FROM Life_cycle
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Error fetching Life_Cycle records:", err);
    res.status(500).json({ error: "Failed to fetch lifecycle records" });
  }
});




// Upload Route
router.post('/upload/:sessionId', upload.single('document'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const file = req.file;
    const { documentName } = req.body;  // 👈 get from FormData

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('✅ File received:', file.originalname);
    console.log('📄 DocumentName received:', documentName); // 👈 FIXED

    // ✅ Compute file hash
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

    const pool = await getPool();

    const checkResult = await pool.request()
      .input('FileHash', sql.NVarChar(100), fileHash)
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .query(`
        SELECT Id 
        FROM SB_TF_ingestion_Sets 
        WHERE FileHash = @FileHash AND SessionId = @SessionId
      `);

    if (checkResult.recordset.length > 0) {
      fs.unlinkSync(file.path);
      return res.status(409).json({
        error: 'Duplicate document upload detected in this session. This file already exists.'
      });
    }

    const result = await pool.request()
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .input('FileName', sql.NVarChar(255), file.originalname)
      .input('FileType', sql.NVarChar(100), path.extname(file.originalname).substring(1))
      .input('FileSize', sql.Int, file.size)
      .input('FilePath', sql.NVarChar(500), `/uploads/${file.filename}`)
      .input('FileHash', sql.NVarChar(100), fileHash)
      .input('DocumentName', sql.NVarChar(255), documentName) // 👈 will no longer be null
      .query(`
        INSERT INTO SB_TF_ingestion_Sets 
        (SessionId, FileName, FileType, FileSize, FilePath, FileHash, DocumentName)
        OUTPUT INSERTED.Id
        VALUES (@SessionId, @FileName, @FileType, @FileSize, @FilePath, @FileHash, @DocumentName)
      `);

    const insertedId = result.recordset[0].Id;

    res.status(201).json({
      message: 'Document uploaded successfully.',
      fileName: file.originalname,
      id: insertedId,
      DocumentName: documentName, // 👈 return it so frontend gets it
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
    SELECT Id, FileName, FileType, FileSize, FilePath, DocumentName, UploadedAt
    FROM SB_TF_ingestion_Sets
    WHERE SessionId = @SessionId
  `);

    // console.log('Fetched documents:', result.recordset);
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('❌ Failed to fetch documents by session:', error);
    res.status(500).json({ error: 'Failed to fetch documents for the session' });
  }
});


// ✅ Get session metadata
router.get('/session/:sessionId/meta', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input('SessionId', sql.UniqueIdentifier, sessionId)
      .query(`
        SELECT 
          id, cifNumber, lcNumber, lifecycle, status, userId, iterations, 
          createdAt, updatedAt, cusName, cusCategory, instrument
        FROM SB_TF_ingestion_Box
        WHERE id = @SessionId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Session metadata not found' });
    }

    res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error('❌ Failed to fetch session metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata for the session' });
  }
});


// Get the Extracted OCR text 

router.get("/ocr/:sessionId", async (req, res) => {
  const { sessionId } = req.params;


  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("sessionId", sql.VarChar, sessionId)
      .query(`
        SELECT o.id, 
               o.session_id, 
               o.document_id, 
               o.form_type, 
               o.ocr_text, 
               o.created_at,
               s.DocumentName,
               s.FileName,
               s.FilePath
        FROM TF_ingestion_CleanedOCR o
        INNER JOIN SB_TF_ingestion_Sets s
          ON o.document_id = s.Id
        WHERE o.session_id = @sessionId
        ORDER BY o.created_at DESC
      `);

    res.json({ results: result.recordset });
  } catch (err) {
    console.error("❌ Failed to fetch OCR docs:", err);
    res.status(500).json({ error: "Failed to fetch OCR documents" });
  }
});

// GET extracted fields by session_id and document_id
router.get("/:session_id/:document_id/fields", async (req, res) => {
  const { session_id, document_id } = req.params;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("session_id", sql.VarChar, session_id)
      .input("document_id", sql.VarChar, document_id)
      .query(`
        SELECT field_key, field_value
        FROM TF_fields_KeyValuePair
        WHERE session_id = @session_id AND document_id = @document_id
        ORDER BY extracted_at DESC
      `);

    res.json(
      result.recordset.map((row) => ({
        key: row.field_key,
        value: row.field_value,
      }))
    );
  } catch (err) {
    console.error("❌ Error fetching fields:", err);
    res.status(500).json({ error: "Failed to fetch fields" });
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
      { table: "TF_mdocs_mgroups", col: "document_id" },
      { table: "TF_fields_KeyValuePair", col: "document_id" } // <-- Added
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


// Existing lifecycle

router.post('/split/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, documentId, ocrMethod = 'azure' } = req.body;

  const serverRoot = path.join(__dirname, '..', '..');
  const actualUploadDir = path.join(serverRoot, 'uploads');
  // const scriptPath = path.join(__dirname, '..', 'python', 'split_OCR.py');
  const scriptPath = path.join(__dirname, '..', 'python', 'OCR_Alone.py');

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


// New lifecycle 

router.post('/newsplit/:sessionId', async (req, res) => {
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

router.get('/:id/pdf-info-new', async (req, res) => {
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

router.get("/grouped-fields/:sessionId/:documentId", async (req, res) => {
  const { sessionId, documentId } = req.params;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('session_id', sql.VarChar, sessionId)
      .input('document_id', sql.VarChar, documentId)
      .query(`
        SELECT form_type, fields_json
        FROM TF_ingestion_mGroupsFields
        WHERE session_id = @session_id AND document_id = @document_id
        ORDER BY created_at
      `);

    if (result.recordset.length === 0) {
      return res.json({ pages: {} });
    }

    // Group fields by form_type
    const groupedPages = {};
    result.recordset.forEach((row) => {
      const formType = row.form_type || "unclassified";

      let fields = [];
      try {
        fields = JSON.parse(row.fields_json); // parse JSON array
      } catch (err) {
        console.error("❌ Failed to parse fields_json:", err);
      }

      if (!groupedPages[formType]) {
        groupedPages[formType] = [];
      }

      groupedPages[formType].push(...fields); // merge all JSON objects
    });

    res.json({ pages: groupedPages });
  } catch (err) {
    console.error("❌ Error fetching grouped fields:", err);
    res.status(500).json({ error: "Failed to fetch grouped fields" });
  }
});






// File Names
router.get("/grouped-files-name/:sessionId/:documentId", async (req, res) => {
  const { sessionId, documentId } = req.params;

  if (!sessionId || !documentId) {
    return res.status(400).json({ error: "Missing sessionId or documentId" });
  }

  try {
    const pool = await getPool();

    // Fetch only form_type (document name) and document_id
    const result = await pool.request()
      .input("sessionId", sql.VarChar, sessionId)
      .input("documentId", sql.VarChar, documentId)
      .query(`
        SELECT document_id AS documentId, form_type AS formName
        FROM TF_ingestion_mGroupsPDF
        WHERE session_id = @sessionId AND document_id = @documentId
      `);

    res.json({ forms: result.recordset });
  } catch (err) {
    console.error("❌ Error fetching grouped document names:", err);
    res.status(500).json({ error: "Failed to fetch grouped document names" });
  }
});



router.post("/update-grouped-name", async (req, res) => {
  const { sessionId, documentId, oldName, newName } = req.body;

  if (!sessionId || !documentId || !oldName || !newName) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const pool = await getPool();
    const tables = ["TF_ingestion_mGroupsPDF", "TF_ingestion_mGroupsOCR", "TF_ingestion_mGroupsFields"];

    for (const table of tables) {
      await pool.request()
        .input("newName", sql.VarChar, newName)
        .input("sessionId", sql.UniqueIdentifier, sessionId)
        .input("documentId", sql.UniqueIdentifier, documentId)
        .input("oldName", sql.VarChar, oldName)
        .query(`
          UPDATE ${table}
          SET form_type = @newName
          WHERE session_id = @sessionId
            AND document_id = @documentId
            AND form_type = @oldName
        `);
    }

    // **Update catalog table so Catalog tab shows new names**
    await pool.request()
      .input("newName", sql.VarChar, newName)
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("documentId", sql.UniqueIdentifier, documentId)
      .input("oldName", sql.VarChar, oldName)
      .query(`
        UPDATE TF_mdocs_mgroups
        SET grouped_form_type = @newName,
            matched_document_name = @newName
        WHERE session_id = @sessionId
          AND document_id = @documentId
          AND grouped_form_type = @oldName
      `);

    res.json({ success: true, message: "Grouped document name updated successfully." });
  } catch (err) {
    console.error("❌ Error updating grouped document name:", err);
    res.status(500).json({ error: "Failed to update grouped document name." });
  }
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
      files: splitFiles.map(name => {
        const baseName = path.basename(name, '.pdf'); // this removes .pdf cleanly
        return {
          fileName: name,
          pdfPath: `/outputs/${sessionId}/${folder.name}/${name}`,
          textPath: `/outputs/${sessionId}/${folder.name}/${baseName}.txt`,
          jsonPath: `/outputs/${sessionId}/${folder.name}/${baseName}.fields.json`
        };
      })
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


// router.get('/:sessionId/:documentId/fields', async (req, res) => {
//   const { sessionId, documentId } = req.params;

//   try {
//     await sql.connect(config);
//     const result = await sql.query`
//       SELECT field_key, field_value 
//       FROM TF_fields_KeyValuePair
//       WHERE session_id = ${sessionId} AND document_id = ${documentId}
//       ORDER BY id
//     `;

//     console.log('DB result:', result.recordset); // debug

//     const fields = {};
//     result.recordset.forEach(row => {
//       fields[row.field_key] = row.field_value;
//     });
//     result.recordset.forEach(row => {
//       fields[row.field_key] = String(row.field_value);
//     });

//     res.json({ fields });
//   } catch (err) {
//     console.error('❌ Error fetching fields from DB:', err);
//     res.status(500).json({ error: 'Failed to fetch fields' });
//   } finally {
//     await sql.close();
//   }
// });


// GET forms list

// router.get("/forms/list/:docId", async (req, res) => {
//   try {
//     const { docId } = req.params;
//     const pool = await getPool();

//     const result = await pool.request()
//       .input("documentId", sql.UniqueIdentifier, docId)
//       .query(`
//         SELECT id AS formId, form_type AS formName
//         FROM TF_ingestion_mGroupsOCR
//         WHERE document_id = @documentId
//       `);

//     res.json(result.recordset);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Failed to fetch forms");
//   }
// });


// // ✅ Route 2: Get forms from CleanedOCR table (document_id = int)
// router.get("/forms/cleaned/:docId", async (req, res) => {
//   try {
//     const { docId } = req.params;
//     const pool = await getPool();

//     const result = await pool.request()
//       .input("documentId", sql.UniqueIdentifier, docId)  // ✅ use UniqueIdentifier
//       .query(`
//         SELECT id AS formId, form_type AS formName, ocr_text
//         FROM TF_ingestion_CleanedOCR
//         WHERE document_id = @documentId
//       `);

//     res.json(result.recordset);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Failed to fetch CleanedOCR forms");
//   }
// });


router.get("/forms/list/:docId", async (req, res) => {
  try {
    const { docId } = req.params;
    const pool = await getPool();

    // First check mGroups
    const mGroupsResult = await pool.request()
      .input("docId", sql.UniqueIdentifier, docId)
      .query(`
        SELECT id AS formId, form_type AS formName, ocr_text
        FROM TF_ingestion_mGroupsOCR
        WHERE document_id = @docId
      `);

    if (mGroupsResult.recordset.length > 0) {
      return res.json({ forms: mGroupsResult.recordset });
    }

    // If empty → fallback to Cleaned
    const cleanedResult = await pool.request()
      .input("docId", sql.UniqueIdentifier, docId)
      .query(`
        SELECT id AS formId, form_type AS formName, ocr_text
        FROM TF_ingestion_CleanedOCR
        WHERE document_id = @docId
      `);

    return res.json({ forms: cleanedResult.recordset });

  } catch (err) {
    console.error("Error fetching forms:", err);
    res.status(500).send("Server error");
  }
});





router.get("/forms/:docId", async (req, res) => {
  try {
    const pool = await getPool();
    const { docId } = req.params;
    const { type } = req.query;

    if (!["pdf", "text", "fields"].includes(String(type))) {
      return res.status(400).send("Invalid type. Use pdf, text, or fields.");
    }

    if (type === "pdf") {
      // PDFs only from original table
      const result = await pool.request()
        .input("docId", sql.UniqueIdentifier, docId)
        .query("SELECT file_data FROM TF_ingestion_mGroupsPDF WHERE document_id = @docId");

      if (!result.recordset[0]?.file_data) {
        return res.status(404).send("PDF not found");
      }

      res.setHeader("Content-Type", "application/pdf");
      return res.send(result.recordset[0].file_data);
    }

    if (type === "text") {
      // Fetch both OCR tables
      const [orig, cleaned] = await Promise.all([
        pool.request()
          .input("docId", sql.UniqueIdentifier, docId)
          .query("SELECT ocr_text FROM TF_ingestion_mGroupsOCR WHERE document_id = @docId"),
        pool.request()
          .input("docId", sql.UniqueIdentifier, docId)
          .query("SELECT ocr_text FROM TF_ingestion_CleanedOCR WHERE document_id = @docId")
      ]);

      const combinedText = `${orig.recordset[0]?.ocr_text || ""}\n${cleaned.recordset[0]?.ocr_text || ""}`;
      if (!combinedText.trim()) return res.status(404).send("Text not found");

      return res.json({ text: combinedText });
    }

    if (type === "fields") {
      // Original fields
      const origResult = await pool.request()
        .input("docId", sql.UniqueIdentifier, docId)
        .query("SELECT fields_json FROM TF_ingestion_mGroupsFields WHERE document_id = @docId");

      const origFields = origResult.recordset[0]?.fields_json ? JSON.parse(origResult.recordset[0].fields_json) : [];

      // Cleaned key-value pairs
      const cleanedResult = await pool.request()
        .input("docId", sql.UniqueIdentifier, docId)
        .query("SELECT field_key, field_value FROM TF_fields_KeyValuePair WHERE document_id = @docId");

      const cleanedFields = {};
      cleanedResult.recordset.forEach(f => {
        cleanedFields[f.field_key] = f.field_value;
      });

      const combinedFields = [...origFields, cleanedFields];
      if (combinedFields.length === 0) return res.status(404).send("Fields not found");

      return res.json(combinedFields);
    }

  } catch (err) {
    console.error("Error fetching form data:", err);
    res.status(500).send("Server error");
  }
});


router.get("/forms/list/:docId", async (req, res) => {
  try {
    const pool = await getPool();
    const { docId } = req.params;

    const result = await pool.request()
      .input("docId", sql.UniqueIdentifier, docId)
      .query("SELECT id, form_type, ocr_text FROM TF_ingestion_mGroupsOCR WHERE document_id = @docId");

    const forms = result.recordset.map(row => ({
      id: row.id,          // unique identifier for each form
      formName: row.form_type,
      text: row.ocr_text
    }));

    res.json({ forms });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


router.get("/forms/content/:formId", async (req, res) => {
  try {
    const pool = await getPool();
    const { formId } = req.params;
    const { type } = req.query;

    if (!["pdf", "text", "fields"].includes(String(type))) {
      return res.status(400).send("Invalid type");
    }

    if (type === "pdf") {
      const result = await pool.request()
        .input("formId", sql.Int, formId)
        .query("SELECT file_data FROM TF_ingestion_mGroupsPDF WHERE id = @formId");

      if (!result.recordset[0]?.file_data) return res.status(404).send("PDF not found");

      res.setHeader("Content-Type", "application/pdf");
      return res.send(result.recordset[0].file_data);
    }

    if (type === "text") {
      const result = await pool.request()
        .input("formId", sql.Int, formId)
        .query("SELECT ocr_text FROM TF_ingestion_mGroupsOCR WHERE id = @formId");

      return res.json({ text: result.recordset[0]?.ocr_text || "" });
    }

    if (type === "fields") {
      const result = await pool.request()
        .input("formId", sql.Int, formId)
        .query("SELECT fields_json FROM TF_ingestion_mGroupsFields WHERE id = @formId");

      const fields = result.recordset[0]?.fields_json ? JSON.parse(result.recordset[0].fields_json) : [];
      return res.json(fields);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


router.post("/inventory", async (req, res) => {
  try {
    const { extractedText } = req.body;
    if (!extractedText) {
      return res.status(400).json({ error: "Missing extractedText" });
    }

    const prompt = `
    You are a trade finance assistant.
    From the following LC extracted text, identify the documents required in clause 46A.
    For each document, return JSON with:
      - document_name
      - copies_required
      - raw_clause (the text snippet where it came from)

    Text:
    ${extractedText}
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You extract trade finance LC clause 46A documents." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const result = completion.choices[0].message?.content || "{}";
    const parsed = JSON.parse(result);

    res.json({ requiredDocuments: parsed });
  } catch (err) {
    console.error("Error in 46A extraction:", err);
    res.status(500).json({ error: "Failed to extract 46A documents" });
  }
});


router.post("/save-selection", async (req, res) => {
  const { sessionId, docId, documents } = req.body;

  console.log("📥 Incoming request to /save-selection");
  console.log("SessionId:", sessionId);
  console.log("DocId:", docId);
  console.log("Documents payload:", JSON.stringify(documents, null, 2));

  if (!sessionId || !docId || !documents) {
    console.warn("⚠️ Missing required fields");
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const pool = await getPool();

    for (const doc of documents) {
      console.log(`🔄 Processing document: ${doc.document_name}`);
      console.log("Status:", doc.status, "Notes:", doc.notes);

      await pool.request()
        .input("SessionId", sql.NVarChar, sessionId)
        .input("DocId", sql.NVarChar, docId)
        .input("DocumentName", sql.NVarChar, doc.document_name)
        .input("SelectionStatus", sql.NVarChar, doc.status || null)
        .input("Notes", sql.NVarChar, doc.notes || null)
        .query(`
          IF EXISTS (
            SELECT 1 FROM TF_Document_Inventory
            WHERE SessionId = @SessionId AND DocId = @DocId AND DocumentName = @DocumentName
          )
            UPDATE TF_Document_Inventory
            SET SelectionStatus = @SelectionStatus,
                Notes = @Notes,
                UpdatedAt = GETDATE()
            WHERE SessionId = @SessionId AND DocId = @DocId AND DocumentName = @DocumentName
          ELSE
            INSERT INTO TF_Document_Inventory (SessionId, DocId, DocumentName, SelectionStatus, Notes)
            VALUES (@SessionId, @DocId, @DocumentName, @SelectionStatus, @Notes)
        `);

      console.log(`✅ Document ${doc.document_name} saved/updated`);
    }

    console.log("🎉 All documents processed successfully");
    res.json({ message: "Selection saved successfully" });
  } catch (err) {
    console.error("❌ Error in /save-selection:", err);
    res.status(500).json({ message: "Failed to save selection" });
  }
});







export default router;
