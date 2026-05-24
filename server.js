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

// strict: false ensure karega ki UI se aane wala naya data (Qty, Rate etc) reject na ho
const billSchema = new mongoose.Schema({
    clientCompanyName: String,
    customerName: String,
    customerGST: String,
    invoiceNo: String,
    itemName: String,
    grandTotal: String,
    dateSaved: { type: Date, default: Date.now }
}, { strict: false }); 
const Bill = mongoose.model('Bill', billSchema);

// Original Working Email Script API
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

// UI Matching PDF Generation Logic
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

    // --- EXACT UI MATCHING DESIGN START ---
    const primaryColor = '#1d4ed8'; // Dark Blue 
    const textColor = '#333333';
    const lightText = '#666666';

    // 1. Header Left
    doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', 50, 50);
    doc.fillColor(lightText).fontSize(9).font('Helvetica').text('Original for Recipient', 50, 75);

    // 1. Header Right (Client Details)
    doc.fillColor(textColor).fontSize(12).font('Helvetica-Bold').text(billData.clientCompanyName || 'Your Company Name', 250, 50, { align: 'right', width: 295 });
    doc.font('Helvetica').fontSize(9).fillColor(lightText);
    
    if (billData.clientGST) doc.text(`GSTIN: ${billData.clientGST}`, 250, 68, { align: 'right', width: 295 });
    if (billData.clientState) doc.text(`State: ${billData.clientState}`, 250, 80, { align: 'right', width: 295 });
    if (billData.clientAddress) doc.text(`${billData.clientAddress}`, 250, 95, { align: 'right', width: 295 });

    // Divider Line
    doc.moveTo(50, 130).lineTo(545, 130).lineWidth(1).strokeColor('#e2e8f0').stroke();

    // 2. Billed To (Customer Details)
    doc.fillColor(textColor).fontSize(10).font('Helvetica-Bold').text('Billed To (Customer Details)', 50, 150);
    doc.font('Helvetica').fontSize(10).fillColor(lightText);
    doc.text(`${billData.customerName || 'N/A'}`, 50, 170);
    doc.text(`${billData.customerGST || ''}`, 50, 185);
    doc.text(`${billData.customerAddress || ''}`, 50, 200);

    // 2. Invoice Details
    doc.fillColor(textColor).fontSize(10).font('Helvetica-Bold').text('Invoice Details', 300, 150);
    doc.font('Helvetica').fontSize(9).fillColor(lightText);

    doc.text(`Invoice No.:`, 300, 170);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`${billData.invoiceNo || 'N/A'}`, 300, 185);

    doc.fillColor(lightText).font('Helvetica').text(`Invoice Date:`, 440, 170);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`${new Date().toLocaleDateString()}`, 440, 185);

    doc.fillColor(lightText).font('Helvetica').text(`Type of Supply:`, 300, 205);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`${billData.supplyType || 'Inter-State (Different State - IGST)'}`, 300, 215);

    // 3. Table Header Background (Blue Strip)
    const tableTop = 250;
    doc.rect(50, tableTop, 495, 25).fill(primaryColor);

    // 3. Table Header Text
    const headerY = tableTop + 8;
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    doc.text('Item Description / HSN', 60, headerY);
    doc.text('Qty', 280, headerY, { width: 40, align: 'center' });
    doc.text('Rate (Rs)', 330, headerY, { width: 60, align: 'center' });
    doc.text('GST %', 400, headerY, { width: 40, align: 'center' });
    doc.text('Amount (Rs)', 460, headerY, { width: 75, align: 'right' });

    // 4. Table Row Data
    const rowY = tableTop + 35;
    doc.fillColor(textColor).fontSize(9).font('Helvetica');
    doc.text(billData.itemName || 'N/A', 60, rowY, { width: 210 });
    doc.text(billData.qty || '1', 280, rowY, { width: 40, align: 'center' });
    doc.text(billData.rate || billData.taxableValue || billData.grandTotal || '0', 330, rowY, { width: 60, align: 'center' });
    doc.text(`${billData.gstPercent || '18'}%`, 400, rowY, { width: 40, align: 'center' });
    doc.text(billData.grandTotal || '0', 460, rowY, { width: 75, align: 'right' });

    // Table Bottom Divider
    doc.moveTo(50, rowY + 20).lineTo(545, rowY + 20).lineWidth(1).strokeColor('#e2e8f0').stroke();

    // 5. Total Calculation Box (Bottom Right)
    const totalBoxY = rowY + 40;
    doc.rect(320, totalBoxY, 225, 70).lineWidth(1).strokeColor('#e2e8f0').stroke();

    const taxY = totalBoxY + 10;
    doc.fillColor(lightText).fontSize(9).text('Taxable Value:', 330, taxY);
    doc.fillColor(textColor).text(`Rs. ${billData.taxableValue || '0.00'}`, 460, taxY, { width: 75, align: 'right' });

    doc.fillColor(lightText).text('Tax Amount:', 330, taxY + 18);
    doc.fillColor(textColor).text(`Rs. ${billData.taxAmount || '0.00'}`, 460, taxY + 18, { width: 75, align: 'right' });

    const grandY = taxY + 40;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor).text('Grand Total:', 330, grandY);
    doc.text(`Rs. ${billData.grandTotal || '0.00'}`, 440, grandY, { width: 95, align: 'right' });

    // --- EXACT UI MATCHING DESIGN END ---

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