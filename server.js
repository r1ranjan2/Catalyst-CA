require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("🟢 Cloud Database connected successfully!"))
    .catch((err) => console.log("🔴 DB Connection Error:", err.message));

// Schemas
const userSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    gstin: String,
    address: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationToken: String
});
const User = mongoose.model('User', userSchema);

const billSchema = new mongoose.Schema({
    clientCompanyName: String,
    customerName: String,
    customerGST: String,
    invoiceNo: String,
    itemName: String,
    grandTotal: String,
    dateSaved: { type: Date, default: Date.now }
});
const Bill = mongoose.model('Bill', billSchema);

// Updated Email Function via Google Apps Script
async function sendEmailViaScript(toEmail, subject, htmlContent, base64Attachment = null, attachmentName = null) {
    try {
        const payload = {
            toEmail: toEmail,
            subject: subject,
            htmlContent: htmlContent
        };

        if (base64Attachment && attachmentName) {
            payload.base64Attachment = base64Attachment;
            payload.attachmentName = attachmentName;
        }

        const response = await fetch(process.env.SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        console.log("🟢 Email Script Response:", result);
    } catch (error) {
        console.error("🔴 Error calling Email Script:", error);
    }
}

// Professional PDF Generate aur Send karne ka logic
function generateAndSendPDF(billData) {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    let buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);
        const base64String = pdfBuffer.toString('base64'); 

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #1e3a8a;">New Invoice Received!</h2>
                <p>A client has submitted a new tax invoice on the portal.</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
                <p><strong>Client Company:</strong> ${billData.clientCompanyName || 'N/A'}</p>
                <p><strong>Invoice No:</strong> ${billData.invoiceNo || 'N/A'}</p>
                <p><strong>Grand Total:</strong> Rs. ${billData.grandTotal || '0'}</p>
            </div>
        `;

        try {
            await sendEmailViaScript(
                "contactcatalystca@gmail.com", 
                `📄 New Invoice Submitted: ${billData.invoiceNo}`, 
                htmlContent,
                base64String,
                `Invoice_${billData.invoiceNo}.pdf`
            );
        } catch (error) {
            console.log("🔴 Failed to send PDF email:", error.message);
        }
    });

    // --- PDF DESIGN START ---
    
    // Header
    doc.fillColor('#333333').fontSize(24).text('TAX INVOICE', { align: 'right' });
    doc.fontSize(10).fillColor('#666666').text(`Invoice Number: ${billData.invoiceNo || 'N/A'}`, { align: 'right' });
    doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
    doc.moveDown(2);

    // Company Info (Billed By)
    doc.fontSize(16).fillColor('#1e3a8a').text(billData.clientCompanyName || 'Your Company Name');
    doc.moveDown(1);

    // Customer Info (Billed To)
    doc.fontSize(12).fillColor('#333333').text('BILLED TO:');
    doc.fontSize(10).fillColor('#555555');
    doc.text(`Customer Name: ${billData.customerName || 'N/A'}`);
    doc.text(`GSTIN: ${billData.customerGST || 'N/A'}`);
    doc.moveDown(2);

    // Invoice Table Header
    const tableTop = doc.y;
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, tableTop).lineTo(545, tableTop).stroke();
    doc.moveDown(0.5);
    
    doc.fontSize(10).fillColor('#333333').font('Helvetica-Bold');
    doc.text('Item Description', 50, doc.y, { continued: true, width: 300 });
    doc.text('Amount', 350, doc.y, { align: 'right', width: 195 });
    
    doc.moveDown(0.5);
    const tableBottom = doc.y;
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, tableBottom).lineTo(545, tableBottom).stroke();
    doc.moveDown(1);

    // Table Row
    doc.font('Helvetica').fillColor('#555555');
    doc.text(billData.itemName || 'N/A', 50, doc.y, { continued: true, width: 300 });
    doc.text(`Rs. ${billData.grandTotal || '0'}`, 350, doc.y, { align: 'right', width: 195 });
    doc.moveDown(1);

    // Grand Total Section
    const summaryTop = doc.y;
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(350, summaryTop).lineTo(545, summaryTop).stroke();
    doc.moveDown(0.5);
    
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000');
    doc.text('Grand Total:', 350, doc.y, { continued: true, width: 100 });
    doc.text(`Rs. ${billData.grandTotal || '0'}`, 450, doc.y, { align: 'right', width: 95 });
    
    // --- PDF DESIGN END ---

    doc.end();
}

// Routes
app.post('/api/register', async (req, res) => {
    try {
        const { companyName, gstin, address, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email already registered!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = "TOKEN-" + Math.random().toString(36).substring(2, 15);

        const newUser = new User({
            companyName, gstin, address, email, password: hashedPassword, verificationToken: token
        });
        await newUser.save();

        const verificationLink = `https://catalyst-ca.onrender.com/api/verify-email?token=${token}`;
        
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                <h2 style="color: #1d4ed8;">Welcome to Catalyst CA!</h2>
                <p>Hello <strong>${companyName}</strong>,</p>
                <p>Please click the button below to verify your email address. This step is required to activate your account and start generating invoices.</p>
                <a href="${verificationLink}" style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px;">Activate My Account</a>
            </div>
        `;

        await sendEmailViaScript(email, 'Activate your Catalyst CA Portal Account', htmlContent);
        res.status(200).json({ message: "Registration successful! Please check your email." });
    } catch (error) {
        console.log("Registration Error: ", error);
        res.status(500).json({ message: "Server error during registration!" });
    }
});

app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).send("<h3>Invalid or expired link!</h3>");
        
        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();
        
        res.send(`
            <div style="text-align: center; font-family: Arial, sans-serif; margin-top: 50px;">
                <h2 style="color: green;">Account Activated Successfully! ✅</h2>
                <p>You can now close this tab and login to your portal.</p>
            </div>
        `);
    } catch (error) {
        res.status(500).send("Server Error.");
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Account not found!" });
        if (!user.isVerified) return res.status(400).json({ message: "Please verify your email first! Check your inbox." });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });
        
        res.status(200).json({ companyName: user.companyName, gstin: user.gstin, address: user.address });
    } catch (error) {
        res.status(500).json({ message: "Server error!" });
    }
});

app.post('/api/save-bill', async (req, res) => {
    try {
        const savedBill = new Bill(req.body);
        await savedBill.save();
        res.status(200).json({ message: "Success! Bill submitted." });
        
        generateAndSendPDF(req.body);
    } catch (error) {
        res.status(500).json({ message: "Failed to store invoice." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Catalyst CA Backend running at Port: ${PORT}`);
});