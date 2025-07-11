import { sql, getPool } from '../config/database.js';
import fs from 'fs';
import path from 'path';

export class DocumentModel {
  static async uploadDocument(documentData) {
    try {
      const pool = await getPool();
      const request = pool.request();

      const istDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

      const result = await request
        .input('sessionId', sql.VarChar(50), documentData.sessionId)
        .input('fileName', sql.VarChar(255), documentData.fileName)
        .input('fileType', sql.VarChar(50), documentData.fileType)
        .input('fileSize', sql.BigInt, documentData.fileSize)
        .input('filePath', sql.VarChar(500), documentData.filePath)
        .input('status', sql.VarChar(20), 'uploaded')
        .input('uploadedAt', sql.DateTime, istDate)
        .query(`
          INSERT INTO ingestion_document_raw 
          (sessionId, fileName, fileType, fileSize, filePath, status, uploadedAt)
          OUTPUT INSERTED.*
          VALUES (@sessionId, @fileName, @fileType, @fileSize, @filePath, @status, @uploadedAt)
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  }

  static async getDocumentsBySession(sessionId) {
    try {
      const pool = await getPool();
      const request = pool.request();

      const result = await request
        .input('sessionId', sql.VarChar(50), sessionId)
        .query(`
          SELECT 
            dr.*,
            dc.cleanedContent,
            dc.extractedFields,
            dc.matchedTemplate,
            dc.isNewDocument
          FROM ingestion_document_raw dr
          LEFT JOIN ingestion_document_cleaned dc ON dr.id = dc.documentId
          WHERE dr.sessionId = @sessionId 
          ORDER BY dr.uploadedAt DESC
        `);

      // Parse extracted fields JSON and enhance documents
      const enhancedDocuments = result.recordset.map(doc => ({
        ...doc,
        rawContent: doc.cleanedContent || null,
        extractedFields: doc.extractedFields ? JSON.parse(doc.extractedFields) : [],
        matchedTemplate: doc.matchedTemplate ? { name: doc.matchedTemplate } : null,
        isNewDocument: doc.isNewDocument || false,
        iterations: [] // This would be populated from iterations table
      }));

      return enhancedDocuments;
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw error;
    }
  }

  static async getDocumentById(documentId) {
    try {
      const pool = await getPool();
      const request = pool.request();

      const result = await request
        .input('documentId', sql.VarChar(50), documentId)
        .query(`
          SELECT * FROM ingestion_document_raw 
          WHERE id = @documentId
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching document by ID:', error);
      throw error;
    }
  }

  static async getAllDocuments() {
    try {
      const pool = await getPool();
      const request = pool.request();

      const result = await request.query(`
        SELECT * FROM ingestion_document_raw 
        ORDER BY uploadedAt DESC
      `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching all documents:', error);
      throw error;
    }
  }

  static async updateDocumentStatus(documentId, status) {
    try {
      const pool = await getPool();
      const request = pool.request();

      const result = await request
        .input('documentId', sql.VarChar(50), documentId)
        .input('status', sql.VarChar(20), status)
        .query(`
          UPDATE ingestion_document_raw 
          SET status = @status
          OUTPUT INSERTED.*
          WHERE id = @documentId
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error updating document status:', error);
      throw error;
    }
  }

static async deleteDocument(documentId) {
  try {
    const pool = await getPool();
    const request = pool.request();

    // Step 1: Get file info (and sessionId for split folder)
    const document = await request
      .input('documentId', sql.UniqueIdentifier, documentId)
      .query(`
        SELECT id, filePath, session_id 
        FROM ingestion_document_raw 
        WHERE id = @documentId
      `);

    if (document.recordset.length === 0) {
      console.log("⚠️ Document not found.");
      return { success: false, message: 'Document not found' };
    }

    const { filePath, session_id } = document.recordset[0];

    // Step 2: Delete uploaded file from disk
    const uploadsDir = process.env.UPLOAD_PATH || './uploads';
    const fullPath = path.join(uploadsDir, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`🗑️ Deleted uploaded file: ${fullPath}`);
    }

    // Step 3: Delete split folder (text/pdf/json)
    const baseOutputPath = process.env.OUTPUT_PATH || './outputs';
    const baseName = path.basename(filePath, path.extname(filePath)); // remove extension
    const splitFolder = path.join(baseOutputPath, session_id, `${baseName}-${documentId}`);
    if (fs.existsSync(splitFolder)) {
      fs.rmSync(splitFolder, { recursive: true, force: true });
      console.log(`🧹 Deleted split folder: ${splitFolder}`);
    } else {
      console.log("⚠️ Split folder does not exist:", splitFolder);
    }

    // Step 4: Delete from TF_ingestion_CleanedPDF
    await pool.request()
      .input('docId', sql.UniqueIdentifier, documentId)
      .query(`DELETE FROM TF_ingestion_CleanedPDF WHERE document_id = @docId`);

    // Step 5: Delete from TF_ingestion_CleanedOCR
    await pool.request()
      .input('docId', sql.UniqueIdentifier, documentId)
      .query(`DELETE FROM TF_ingestion_CleanedOCR WHERE document_id = @docId`);

    // Step 6: Delete raw record
    await pool.request()
      .input('documentId', sql.UniqueIdentifier, documentId)
      .query(`DELETE FROM ingestion_document_raw WHERE id = @documentId`);

    console.log(`✅ Fully deleted document: ${documentId}`);
    return { success: true };

  } catch (err) {
    console.error("🔥 Error during deleteDocument:", err);
    throw err;
  }
}




  static async saveCleanedDocument(cleanedData) {
    try {
      const pool = await getPool();
      const request = pool.request();

      // First check if cleaned document already exists
      const existingResult = await request
        .input('documentId', sql.VarChar(50), cleanedData.documentId)
        .query(`
          SELECT id FROM ingestion_document_cleaned 
          WHERE documentId = @documentId
        `);

      if (existingResult.recordset.length > 0) {
        // Update existing record
        const updateResult = await request
          .input('cleanedContent', sql.Text, cleanedData.cleanedContent)
          .input('extractedFields', sql.Text, JSON.stringify(cleanedData.extractedFields))
          .input('matchedTemplate', sql.VarChar(100), cleanedData.matchedTemplate)
          .input('isNewDocument', sql.Bit, cleanedData.isNewDocument)
          .input('processedAt', sql.DateTime, new Date())
          .query(`
            UPDATE ingestion_document_cleaned 
            SET 
              cleanedContent = @cleanedContent,
              extractedFields = @extractedFields,
              matchedTemplate = @matchedTemplate,
              isNewDocument = @isNewDocument,
              processedAt = @processedAt
            OUTPUT INSERTED.*
            WHERE documentId = @documentId
          `);

        return updateResult.recordset[0];
      } else {
        // Insert new record
        const insertResult = await request
          .input('sessionId', sql.VarChar(50), cleanedData.sessionId)
          .input('cleanedContent', sql.Text, cleanedData.cleanedContent)
          .input('extractedFields', sql.Text, JSON.stringify(cleanedData.extractedFields))
          .input('matchedTemplate', sql.VarChar(100), cleanedData.matchedTemplate)
          .input('isNewDocument', sql.Bit, cleanedData.isNewDocument)
          .input('processedAt', sql.DateTime, new Date())
          .query(`
            INSERT INTO ingestion_document_cleaned 
            (documentId, sessionId, cleanedContent, extractedFields, matchedTemplate, isNewDocument, processedAt)
            OUTPUT INSERTED.*
            VALUES (@documentId, @sessionId, @cleanedContent, @extractedFields, @matchedTemplate, @isNewDocument, @processedAt)
          `);

        return insertResult.recordset[0];
      }
    } catch (error) {
      console.error('Error saving cleaned document:', error);
      throw error;
    }
  }

  static async getCleanedDocument(documentId) {
    try {
      const pool = await getPool();
      const request = pool.request();

      const result = await request
        .input('documentId', sql.VarChar(50), documentId)
        .query(`
          SELECT * FROM ingestion_document_cleaned 
          WHERE documentId = @documentId
          ORDER BY processedAt DESC
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching cleaned document:', error);
      throw error;
    }
  }

  static async getCleanedDocumentsBySession(sessionId) {
    try {
      const pool = await getPool();
      const request = pool.request();

      const result = await request
        .input('sessionId', sql.VarChar(50), sessionId)
        .query(`
          SELECT * FROM ingestion_document_cleaned 
          WHERE sessionId = @sessionId
          ORDER BY processedAt DESC
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching cleaned documents by session:', error);
      throw error;
    }
  }
}