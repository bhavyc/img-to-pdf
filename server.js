// server.js

const express = require('express');
const multer = require('multer');
const { PDFDocument, degrees } = require('pdf-lib');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// ==========================================
// 1. CONFIGURATION: IN-MEMORY STORAGE
// ==========================================
// We use multer.memoryStorage() to ensure files are stored as Buffers in RAM.
// They are NEVER written to the disk (not even to a /tmp folder).
const storage = multer.memoryStorage();

// Security: Limit file size to 10MB to prevent Memory Exhaustion attacks (DoS).
// Since we store everything in RAM, unlimited file sizes could crash the server.
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

// Serve static files (HTML interface)
app.use(express.static('public'));

// ==========================================
// 2. ROUTE: MERGE PDFs
// ==========================================
// Accepts multiple files. Merges them into one.
app.post('/api/merge', upload.array('pdfs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Please upload at least 2 PDF files.');
        }

        // Create a new empty PDF document
        const mergedPdf = await PDFDocument.create();

        // Loop through uploaded files (available in req.files as Buffers)
        for (const file of req.files) {
            // Load the PDF from the memory buffer
            const pdf = await PDFDocument.load(file.buffer);
            
            // Copy all pages from the uploaded PDF
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            
            // Add pages to the new document
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        // Save the merged PDF as a new Buffer
        const pdfBytes = await mergedPdf.save();

        // CLEANUP: Explicitly nullify the request files to help Garbage Collection
        req.files = null;

        // Send response
        sendPdfResponse(res, pdfBytes, 'merged_document.pdf');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error processing PDF');
    }
});

// ==========================================
// 3. ROUTE: SPLIT PDF
// ==========================================
// Extracts the first page of the uploaded PDF (Demo logic).
app.post('/api/split', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('Please upload a PDF file.');
        }

        // Load the uploaded PDF from RAM
        const srcPdf = await PDFDocument.load(req.file.buffer);
        
        // Create a new PDF for the extracted page
        const newPdf = await PDFDocument.create();
        
        // Copy the first page (index 0)
        // You can expand this logic to accept page numbers from the frontend
        const [firstPage] = await newPdf.copyPages(srcPdf, [0]);
        
        newPdf.addPage(firstPage);

        const pdfBytes = await newPdf.save();

        // CLEANUP
        req.file = null;

        sendPdfResponse(res, pdfBytes, 'split_page_1.pdf');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error processing PDF');
    }
});

// ==========================================
// 4. ROUTE: COMPRESS / MODIFY
// ==========================================
// Note: True "compression" usually requires native binaries (like Ghostscript).
// To keep this pure Node.js (secure/memory-only), we will remove metadata
// and objects, which often reduces size slightly, or simply rotate pages.
app.post('/api/rotate', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');

        const pdfDoc = await PDFDocument.load(req.file.buffer);
        const pages = pdfDoc.getPages();

        // Rotate every page by 90 degrees
        pages.forEach(page => {
            page.setRotation(degrees(90));
        });

        const pdfBytes = await pdfDoc.save();
        
        // CLEANUP
        req.file = null;

        sendPdfResponse(res, pdfBytes, 'rotated.pdf');

    } catch (err) {
        res.status(500).send('Error rotating PDF');
    }
});

// Helper function to send headers and binary data
function sendPdfResponse(res, buffer, filename) {
    // Tell browser this is a PDF
    res.setHeader('Content-Type', 'application/pdf');
    // Tell browser to download it
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    // Send the binary data
    res.send(Buffer.from(buffer));
}
// ==========================================
// 5. ROUTE: IMAGES TO PDF (JPG/PNG)
// ==========================================
// Converts uploaded images into a single PDF document.
app.post('/api/images-to-pdf', upload.array('images', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('Please upload at least one image.');
        }

        // Create a new PDF
        const pdfDoc = await PDFDocument.create();

        for (const file of req.files) {
            let image;
            
            // Check file type and embed accordingly
            // Note: pdf-lib supports JPG and PNG directly
            if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
                image = await pdfDoc.embedJpg(file.buffer);
            } else if (file.mimetype === 'image/png') {
                image = await pdfDoc.embedPng(file.buffer);
            } else {
                continue; // Skip unsupported files
            }

            // Get image dimensions
            const { width, height } = image.scale(1);

            // Add a page matching the image size
            const page = pdfDoc.addPage([width, height]);

            // Draw the image on that page
            page.drawImage(image, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
        }

        const pdfBytes = await pdfDoc.save();

        // CLEANUP
        req.files = null;

        sendPdfResponse(res, pdfBytes, 'images_converted.pdf');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error converting images to PDF');
    }
});
app.listen(port, () => {
    console.log(`Privacy PDF Tool running at http://localhost:${port}`);
});
